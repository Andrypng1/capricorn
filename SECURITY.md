# Seguridad

Solo se mantiene la última versión publicada de Capricorn. La app funciona localmente, sin servidor propio. La base SQLite y las copias quedan en el equipo del usuario. El Administrador de credenciales de Windows guarda las contraseñas de enlaces y las credenciales de API. Las integraciones consultan servicios externos para las funciones que las necesitan.

## Reportes privados

Usa **Security → Report a vulnerability** en GitHub mediante Private Vulnerability Reporting. Si ese canal no está disponible, escribe a **andrypng17@gmail.com**. Incluye versión, comportamiento e impacto, con datos ficticios y sin adjuntar bases de datos, archivos .capricorn ni credenciales. Mantén el informe fuera de las incidencias públicas.

## CSP

El renderizador conserva `style-src 'self' 'unsafe-inline'`. Vite inyecta etiquetas de estilo en desarrollo y la interfaz configura propiedades CSS dinámicas para el escalado de vista previa, los avatares y la navegación. Una política más estricta requiere verificar desarrollo y aplicación empaquetada por separado. La política de scripts y la CSP independiente del HTML de factura permanecen vigentes.


## Acceso a red y carpetas

Las comprobaciones HTTP, miniaturas, avatares y búsquedas de perfiles rechazan destinos locales o privados. La resolución DNS se valida al abrir la conexión y las redirecciones que se siguen pasan por la misma comprobación. Esto no impide abrir manualmente un enlace en el navegador.

La carpeta de datos y la de respaldos configurada se pueden abrir directamente. Al abrir otra carpeta, confirma la ubicación mediante el selector nativo de Windows. Las selecciones se recuerdan durante la sesión de Capricorn.
