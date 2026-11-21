$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$ProgressPreference = 'SilentlyContinue'
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapPixelFormat,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult,Windows.Media.Ocr,ContentType=WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument,Windows.Data.Pdf,ContentType=WindowsRuntime]
$null = [Windows.Data.Pdf.PdfPageRenderOptions,Windows.Data.Pdf,ContentType=WindowsRuntime]
$methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Length -eq 1 }
$generic = $methods | Where-Object { $_.IsGenericMethod -and $_.GetGenericArguments().Length -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation'+[char]96+'1' } | Select-Object -First 1
$action = $methods | Where-Object { -not $_.IsGenericMethod -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
function Wait-Result($operation, [type]$kind) {
  $task = $generic.MakeGenericMethod($kind).Invoke($null,@($operation))
  $task.GetAwaiter().GetResult()
}
function Wait-Action($operation) {
  [void]$action.Invoke($null,@($operation)).GetAwaiter().GetResult()
}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (!$engine) { throw 'Windows no tiene un idioma de reconocimiento de texto disponible.' }
function Read-Image($stream) {
  $decoder = Wait-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  $scale = [Math]::Min(1, $max / [double][Math]::Max($decoder.PixelWidth,$decoder.PixelHeight))
  $resize = [Windows.Graphics.Imaging.BitmapTransform,Windows.Graphics.Imaging,ContentType=WindowsRuntime]::new()
  $resize.ScaledWidth = [uint32][Math]::Max(1,[Math]::Floor($decoder.PixelWidth*$scale))
  $resize.ScaledHeight = [uint32][Math]::Max(1,[Math]::Floor($decoder.PixelHeight*$scale))
  $bitmap = Wait-Result ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,2,$resize,0,0)) ([Windows.Graphics.Imaging.SoftwareBitmap])
  try {
    $answer = Wait-Result ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $words = foreach ($line in $answer.Lines) {
      foreach ($word in $line.Words) {
        $bounds = $word.BoundingRect
        [pscustomobject]@{ X=$bounds.X; Y=($bounds.Y+$bounds.Height/2); Height=$bounds.Height; Text=$word.Text }
      }
    }
    $rows = [System.Collections.Generic.List[string]]::new()
    $row = [System.Collections.Generic.List[object]]::new()
    $rowY = 0.0
    $height = 0.0
    foreach ($word in ($words | Sort-Object Y,X)) {
      if ($row.Count -gt 0 -and [Math]::Abs($word.Y-$rowY) -gt [Math]::Max(4,[Math]::Min($height,$word.Height)*0.45)) {
        $rows.Add((($row | Sort-Object X | ForEach-Object { $_.Text }) -join " "))
        $row.Clear()
      }
      if ($row.Count -eq 0) { $rowY=$word.Y; $height=$word.Height }
      $row.Add($word)
    }
    if ($row.Count -gt 0) { $rows.Add((($row | Sort-Object X | ForEach-Object { $_.Text }) -join " ")) }
    $rows -join [Environment]::NewLine
  } finally { $bitmap.Dispose() }
}
$fileStream = [IO.File]::OpenRead($env:CAPRICORN_OCR_PATH)
$inputStream = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($fileStream)
try {
  if ([IO.Path]::GetExtension($env:CAPRICORN_OCR_PATH) -ieq '.pdf') {
    $pdf = Wait-Result ([Windows.Data.Pdf.PdfDocument]::LoadFromStreamAsync($inputStream)) ([Windows.Data.Pdf.PdfDocument])
    $text = for ($i=0; $i -lt [Math]::Min($pdf.PageCount,3); $i++) {
      $page = $pdf.GetPage([uint32]$i)
      $stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
      try {
        $options = [Windows.Data.Pdf.PdfPageRenderOptions]::new()
        $size = [Math]::Max($page.Size.Width,$page.Size.Height)
        $options.DestinationWidth = [uint32][Math]::Max(1,[Math]::Floor(2200*$page.Size.Width/$size))
        $options.DestinationHeight = [uint32][Math]::Max(1,[Math]::Floor(2200*$page.Size.Height/$size))
        Wait-Action ($page.RenderToStreamAsync($stream,$options))
        $stream.Seek(0)
        Read-Image $stream
      } finally { $stream.Dispose(); $page.Dispose() }
    }
    [Console]::Write(($text -join [Environment]::NewLine))
  } else { [Console]::Write((Read-Image $inputStream)) }
} finally { $inputStream.Dispose(); $fileStream.Dispose() }
