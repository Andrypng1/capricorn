const { execFile } = require("node:child_process");
const { readFileSync, statSync } = require("node:fs");
const { extname, join } = require("node:path");
const { unzipSync, strFromU8 } = require("fflate");
const defaults = { issuer:"", issuerInfo:"", accent:"#2858a4", style:"editorial", footer:"", logo:"" };

function textValue(value, limit = 400) {
  return typeof value === "string" ? value.trim().slice(0,limit) : "";
}
function template(value = {}) {
  return {
    issuer:textValue(value.issuer,120), issuerInfo:textValue(value.issuerInfo), footer:textValue(value.footer),
    accent:/^#[0-9a-f]{6}$/i.test(value.accent) ? value.accent : defaults.accent,
    style:["editorial","minimal","classic"].includes(value.style) ? value.style : defaults.style,
    logo:typeof value.logo === "string" && value.logo.length < 350000 &&
      /^data:image\/jpeg;base64,[a-z0-9+/]+=*$/i.test(value.logo) ? value.logo : "",
  };
}
const { suggest } = require("./receipt-fields.cjs");

async function readReceipt(path) {
  if (statSync(path).size > 24 * 1024 * 1024) throw new Error("El archivo debe pesar menos de 24 MB.");
  const type = extname(path).toLowerCase();
  if (type === ".txt") return suggest(readFileSync(path,"utf8"));
  if (type === ".docx") {
    const files = unzipSync(readFileSync(path),{ filter:({ name,originalSize }) => name === "word/document.xml" && originalSize < 2 * 1024 * 1024 });
    if (!files["word/document.xml"]) throw new Error("No pude leer el contenido de Word.");
    return suggest(strFromU8(files["word/document.xml"]).replace(/<\/w:p>/g,"\n").replace(/<[^>]+>/g,"")
      .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"'));
  }
  if (![".pdf",".png",".jpg",".jpeg",".bmp"].includes(type)) throw new Error("Usa PDF, JPG, PNG, BMP, DOCX o TXT.");
  const command = readFileSync(join(__dirname,"receipt-ocr.ps1"),"utf8");
  return new Promise((resolve,reject) => {
    const ps = join(process.env.SystemRoot ?? "C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");
    execFile(ps, ["-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(command,"utf16le").toString("base64")], {
      windowsHide:true, encoding:"utf8", timeout:35000, maxBuffer:256 * 1024,
      env:{ ...process.env, CAPRICORN_OCR_PATH:path },
    }, (error,stdout) => {
      if (error) reject(new Error("Windows no pudo leer el comprobante. Puedes introducir los datos o pegar su texto."));
      else resolve(suggest(stdout));
    });
  });
}

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c]);
function cents(value, optional = false) {
  const parsed = textValue(value,24).replace(",",".");
  if (!parsed && optional) return null;
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(parsed)) throw new Error("Revisa el importe y la comisión en USD.");
  const [units,fraction=""] = parsed.split(".");
  return Number(units)*100 + Number(fraction.padEnd(2,"0"));
}
function invoiceHtml(design, form, preview = false) {
  const t = template(design);
  if (preview) {
    t.issuer ||= "Estudio de ejemplo";
    const today = new Date();
    const exampleDate = [today.getFullYear(), today.getMonth()+1, today.getDate()].map((part) => String(part).padStart(2,"0")).join("-");
    form = { ...form, number:textValue(form.number,60) || "F-001", customer:textValue(form.customer,140) || "Cliente de ejemplo",
      concept:textValue(form.concept,800) || "Servicio creativo", amount:textValue(form.amount,24) || "125.00",
      date:textValue(form.date,10) || exampleDate };
  }
  const amount = cents(form.amount);
  const fee = cents(form.fee,true);
  const number = textValue(form.number,60), customer = textValue(form.customer,140), concept = textValue(form.concept,800);
  const date = textValue(form.date,10);
  if (!t.issuer || !number || !customer || !concept || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !amount)
    throw new Error("Completa emisor, número, cliente, fecha, concepto e importe.");
  const calendar = new Date(date + "T00:00:00Z");
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0,10) !== date)
    throw new Error("Selecciona una fecha válida.");
  if (fee !== null && fee > amount) throw new Error("La comisión no puede superar el importe.");
  const usd = (value) => new Intl.NumberFormat("en-US",{ style:"currency",currency:"USD" }).format(value/100);
  const details = [["Plataforma",textValue(form.platform,80)],["Referencia del pago",textValue(form.reference,100)]]
    .filter(([,value]) => value).map(([label,value]) => "<p><b>"+escape(label)+"</b><br>"+escape(value)+"</p>").join("");
  return '<!doctype html><html lang="es"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:"><style>'+
    '@page{size:A4;margin:17mm}*{box-sizing:border-box}body{margin:0;font:14px Segoe UI,Arial,sans-serif;color:#263248;overflow-wrap:anywhere}'+
    ':root{--invoice-accent:'+t.accent+'}header{border-top:7px solid var(--invoice-accent);padding:23px 0 16px;display:flex;justify-content:space-between;gap:24px;border-bottom:1px solid #d6dce5;break-inside:avoid}'+
    'h1{font-size:34px;margin:0 0 4px;color:#222d40}h2{font-size:18px}p{margin:8px 0;white-space:pre-wrap;line-height:1.5}'+
    'img{max-width:110px;max-height:65px;margin-bottom:8px}'+
    '.editorial h1{font:700 40px Georgia,serif;letter-spacing:-.02em}.editorial header strong{font:700 19px Georgia,serif}.editorial .total{border-bottom:2px solid var(--invoice-accent)}'+
    '.minimal header{border-top:none;border-bottom:2px solid var(--invoice-accent);padding-top:10px}.minimal h1{font-size:26px;font-weight:600;letter-spacing:.04em}.minimal .line{padding-block:9px}.minimal .total{border-bottom-color:var(--invoice-accent)}'+
    '.classic{font-family:Georgia,serif}.classic header{display:block;text-align:center;border-top:3px double var(--invoice-accent);border-bottom:3px double var(--invoice-accent);padding-block:13px}.classic header strong{font-size:17px}.classic h1{font-size:30px}.classic .total{border-top:3px double var(--invoice-accent)}'+
    (preview ? '@media screen{html{overflow-x:hidden}body{padding:17mm;min-height:297mm}}' : '')+
    '.cols{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:16px 0}.line{display:grid;grid-template-columns:1fr auto;gap:25px;padding:12px 0;border-bottom:1px solid #d6dce5}'+
    '.totals{margin:15px 0 0 auto;width:47%;min-width:180px;break-inside:avoid}.total{font-weight:700;font-size:17px}footer{margin-top:25px;border-top:1px solid #d6dce5;padding-top:10px;color:#48546a}'+
    '</style><body class="'+t.style+'"><header><div>'+(t.logo ? '<img src="'+t.logo+'" alt="">' : '')+
    '<strong>'+escape(t.issuer)+'</strong><p>'+escape(t.issuerInfo)+'</p></div><div><h1>Factura</h1><p>N.º '+escape(number)+'<br>'+escape(date)+'</p></div></header>'+
    '<section class="cols"><div><b>Cliente</b><p>'+escape(customer)+'</p></div><div>'+details+'</div></section>'+
    '<div class="line"><b>Concepto</b><b>Importe (USD)</b></div><div class="line"><p>'+escape(concept)+'</p><p>'+usd(amount)+'</p></div>'+
    '<section class="totals"><div class="line total"><span>Total pagado</span><span>'+usd(amount)+'</span></div>'+
    (fee === null ? "" : '<div class="line"><span>Comisión</span><span>'+usd(fee)+'</span></div><div class="line"><b>Neto recibido</b><b>'+usd(amount-fee)+'</b></div>')+
    '</section><footer>'+(form.notes ? '<b>Notas</b><p>'+escape(textValue(form.notes,1200))+'</p>' : '')+
    (t.footer ? '<p>'+escape(t.footer)+'</p>' : '')+'</footer></body></html>';
}

module.exports = { template, readReceipt, suggest, invoiceHtml };