# Capricorn para Windows

Organizador local de enlaces de clientes y proyectos, desarrollado con Electron, React, TypeScript y SQLite. La aplicación usa la identidad visual de Capricorn y funciona sin cuentas ni servicios de IA.

Capricorn está diseñado para **Windows x64**. Usa un ejecutable de credenciales escrito en C#, OCR mediante PowerShell de Windows y un instalador NSIS. Compila `credentials.exe` con `npm run build:credentials` antes de empaquetar o probar los flujos que usan credenciales.

## Privacidad y seguridad

La aplicación funciona sin cuentas ni telemetría y guarda sus datos localmente. El Administrador de credenciales de Windows almacena las contraseñas de enlaces y las claves de API. Los respaldos `.capricorn` pueden contener datos de clientes, enlaces, imágenes y pagos. Consérvalos en privado.

Las integraciones pueden consultar Konect, Twitch, Kick, YouTube y Google Drive u otros destinos vinculados. Cuando un proveedor requiere credenciales, el usuario aporta las suyas y debe respetar sus términos de servicio.

## Descargas

Cuando haya una versión publicada, descarga el instalador y su hash SHA-256 desde la sección **Releases** del repositorio. Los instaladores no están firmados y Windows SmartScreen puede mostrar una advertencia. Compara el hash con el publicado antes de ejecutar el archivo.

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath .\Capricorn-Instalador-Windows-x64.exe
```

Para compilar desde el código en Windows x64 con Node.js 24 LTS y npm:

```powershell
npm ci
npm run build:credentials
npm run package
```

`npm run package` también compila el ejecutable auxiliar y genera el instalador en `release/`.

## Aviso sobre facturas

Capricorn genera PDF con los datos que introduces. Los requisitos legales y fiscales varían por país. La aplicación no constituye asesoría legal ni fiscal.

## Licencia

Código propio bajo [MIT](LICENSE). Consulta [los avisos de terceros](THIRD_PARTY_NOTICES.md) y [la revisión de recursos](ASSETS_REVIEW.md) antes de redistribuir los iconos.

## Desarrollo

Usa Node.js con npm y ejecuta estos comandos desde la carpeta del proyecto:

```powershell
npm ci
npm start
```

`npm test` comprueba las reglas de búsqueda y validación de URL. `npm run test:desktop` comprueba SQLite desde el runtime de Electron. `npm run package` genera el instalador NSIS x64 en `release`. El instalador alternativo de Windows se genera con `npm run package:dir` seguido de `powershell -NoProfile -File installer/build.ps1`. Empaqueta para el usuario actual y crea un acceso en Inicio. La construcción descarga binarios precompilados y no requiere Rust ni Visual Studio Build Tools.

## Uso

- Crea un cliente, añade un proyecto y guarda enlaces. Capricorn los agrupa por tipo y detecta el servicio por dominio.
- Usa **Hoy** para ver fechas límite, proyectos atrasados y material pendiente que vence dentro de dos días.
- En **Proyectos**, alterna entre lista y tablero. Puedes cambiar el estado arrastrando una tarjeta o usando su selector.
- Abre **Ctrl+K** para buscar clientes, proyectos, enlaces y acciones.
- **Ctrl+Mayús+C** abre el diálogo de captura en la ventana principal. Al abrirlo, lee el portapapeles una vez para sugerir una URL. Cerrar la ventana la oculta en la bandeja. Usa **Salir** en la bandeja para cerrar Capricorn. En **Ajustes** puedes cambiar el atajo global, el comportamiento al cerrar y el inicio con Windows.

## Datos y arquitectura

La interfaz React se comunica con un conjunto acotado de comandos del proceso principal mediante un preload de Electron. El renderizador está aislado y SQLite se ejecuta en el proceso principal con `node:sqlite`. La base aplica migraciones versionadas sobre los datos existentes. Electron abre la base anterior de Tauri en su ubicación original si existe y todavía no hay una base nueva de Electron. En instalaciones nuevas se crea `capricorn.sqlite3` en el directorio de datos de usuario de Electron.

El directorio `desktop` contiene la ventana, la integración con Windows y las consultas. `src` contiene la interfaz y las cadenas en español. `assets` conserva el icono original y sus variantes.

## Fotos de clientes

Capricorn intenta completar la foto al guardar una red, si el cliente aún no tiene foto. En Clientes, usa Buscar fotos de clientes para aplicar la búsqueda a los clientes visibles. Konect sirve sin claves cuando la página enlaza a la cuenta exacta; Twitch o YouTube pueden usar credenciales opcionales.

Pulsa las iniciales o la foto de un cliente, desde Clientes o desde un proyecto. Puedes elegir un archivo JPG, PNG o WebP, copiar una imagen desde el navegador y pegarla en Capricorn, o usar una dirección directa compatible. Capricorn guarda una copia local e incluye la foto en los respaldos. La importación desde un perfil guardado admite Konect y, con credenciales configuradas, Twitch y YouTube.

## Redes sociales de clientes

En Clientes, abre Administrar redes en la ficha de un cliente y pega la dirección de un perfil. Capricorn detecta la plataforma y añade una ficha con icono. Puedes guardar varias cuentas y ponerles una etiqueta, como Cuenta principal o Portafolio. Para abrir una cuenta en el navegador, pulsa su ficha desde Clientes o desde un proyecto del cliente.

La detección reconoce Instagram, TikTok, YouTube, Facebook, X, LinkedIn, Threads, Twitch, WhatsApp y Behance. Otros enlaces quedan como Sitio web. Para corregir una cuenta o quitarla de Capricorn, vuelve a Administrar redes. Las direcciones se incluyen en los archivos .capricorn.

En Ajustes → Búsqueda de redes, configura Twitch con su Client ID y un token de acceso, Kick con su token de acceso y YouTube con una clave de YouTube Data API v3. El Administrador de credenciales de Windows almacena esos datos. Las consultas oficiales se inician al pulsar Buscar redes.

Puedes pegar la URL de Konect directamente. Si la descripción incluye una página de Konect, Capricorn intenta leerla y muestra el origen de cada sugerencia. Abrir perfil y Pegar varios enlaces permiten completar perfiles que aparecen fuera de la descripción.

Buscar redes intenta primero encontrar un perfil de Konect por el nombre del canal o por una variante. Solo usa automáticamente un resultado cuyo perfil enlace de vuelta al canal exacto. Si aún no hay resultados, puede usar credenciales opcionales o sugerir coincidencias de nombre desmarcadas. Las comprobaciones HTTP indican si responde la dirección, si devuelve 404/410 o si el resultado queda sin confirmar. Encontrar una dirección que responde no verifica la identidad de la cuenta.

## Apariencia

En Ajustes → Apariencia, elige Minimalista, Cyberpunk o Moderno. El selector del lateral controla por separado Claro, Oscuro o Sistema. Capricorn recuerda ambas preferencias.

## Navegación

Los apartados y diálogos usan una transición corta de entrada. El indicador de navegación, el tema, la vista de proyectos y los interruptores tienen transiciones CSS que terminan después de cada interacción. Las secciones de enlaces fuera de pantalla tienen una entrada breve al aparecer por primera vez. Capricorn respeta la preferencia de movimiento reducido de Windows.

## Organizar enlaces y añadir miniaturas

En Proyectos, elige el cliente y abre su proyecto. Para guardar varios enlaces del cliente, pulsa Pegar varios enlaces y pega una URL por línea. Elige el tipo y, si la conoces, una fecha de caducidad. Se omiten URLs repetidas del mismo tipo. Cada enlace puede renombrarse desde Editar.

Las secciones separan material, entregas, revisiones y referencias. Los enlaces muestran un icono propio junto al nombre del servicio. Puedes buscar en el proyecto, filtrar por servicio o estado de descarga y ordenar por fecha de incorporación, fecha de caducidad o título.

Abre Miniatura debajo de un enlace a un archivo de Drive y selecciona Buscar miniatura en Drive. Capricorn consulta a Google solo al pulsar el botón y guarda localmente una versión reducida. La disponibilidad depende de los permisos del archivo y de que Drive devuelva una imagen. Puedes elegir una imagen JPG o PNG local para cualquier enlace. Las miniaturas se incluyen en las copias y se eliminan del enlace si cambias su URL.

## Facturas

En Facturas, guarda un diseño con emisor, logo, color, estilo y pie. Selecciona un cliente o un pago anterior para recuperar sus datos. Lee un PDF, JPG, PNG, BMP, DOCX o TXT, pega una captura o introduce los campos manualmente. Windows hace el OCR local de imágenes y de las primeras tres páginas de un PDF. Revisa importe, comisión, referencia, fecha y plataforma, ajusta el concepto y las notas, y exporta el PDF A4. Los importes en otra moneda aparecen en Datos detectados y requieren introducir el importe aplicable en USD. Una comisión ausente se deja en blanco.

## Pagos recibidos

Registra un cobro en USD desde Pagos o desde el proyecto. Indica cliente, fecha, importe y plataforma. El proyecto y la referencia son opcionales. En Pagos puedes filtrar por cliente, plataforma y fechas. El total corresponde al filtro actual. Las fichas de pagos se incluyen en los respaldos. El presupuesto y el estado anteriores no generan cobros automáticamente.

## Entregas, revisiones y pagos

En el detalle de un proyecto, el pago se registra en USD con estado pendiente, parcial o pagado. La actualización aplica la etiqueta USD a los importes anteriores y conserva sus valores numéricos.

El historial destaca la última versión y muestra su fecha, enlace, notas y revisiones pendientes. Puedes registrar o corregir la fecha de entrega, cambiar el enlace o retirar la versión. El siguiente número siempre aumenta. Una revisión asociada a una entrega retirada conserva la referencia.

En Revisiones solicitadas puedes añadir cambios generales o asociados a una versión, editar el texto y la asociación, marcar revisiones como resueltas, reabrirlas y eliminarlas con confirmación. Usa los filtros Todas, Pendientes y Resueltas para revisar el avance.

Comprobar consulta el enlace solo cuando pulsas el botón. Los resultados son orientativos. Enlaces privados pueden necesitar iniciar sesión y responder de forma distinta. La app notifica material por vencer mientras está abierta. El plazo de aviso se configura en Ajustes. La vigilancia del portapapeles en segundo plano está desactivada al instalar.

Desde la sección Contraseña de un enlace, guarda, muestra, copia o quita su contraseña. El secreto se guarda en el Administrador de credenciales de Windows para el usuario actual. SQLite guarda una referencia al enlace.

## Copias, traslado y restauración

En Ajustes → Respaldos y datos, usa Exportar copia para generar un archivo .capricorn. Este archivo ZIP contiene JSON con versión de esquema para clientes y sus redes sociales, proyectos, enlaces, entregas y revisiones, incluidos registros archivados. Restaurar copia sustituye esos registros previa confirmación. Las preferencias de escritorio permanecen configuradas en cada equipo. El contenido de las contraseñas queda en el almacén de Windows. En otro equipo puedes volver a guardarlas. CSV de enlaces y CSV de entregas generan archivos de lectura para hojas de cálculo.

Al elegir una carpeta, Capricorn genera un respaldo diario mientras está abierto y conserva el número de copias indicado. Respaldar ahora crea una copia manual en la misma carpeta. Conserva una copia externa si necesitas trasladar los proyectos a otro equipo.

## Instalar y actualizar

Abre el instalador de Windows x64 y confirma. Si Capricorn está abierto, elige Salir desde la bandeja antes de actualizar. La instalación es por usuario, crea un acceso en Inicio y conserva la base de datos local. Puedes desinstalar desde Aplicaciones instaladas de Windows.

Capricorn funciona sin IA. Las plantillas de mensajes y la ventana independiente de captura quedan pendientes.
