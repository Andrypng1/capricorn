# Portal de revisión

Esta función es opcional. Capricorn conserva proyectos, pagos, facturas y contactos en SQLite. Al crear un enlace, Supabase recibe el título, el estado, el número de versión y, si lo eliges, la URL del archivo. El cliente entra con un enlace revocable de 14 días y puede dejar comentarios sin cuenta. El editor importa cada comentario después de revisarlo.

## Configurar el portal como editor

Cada editor que quiera generar enlaces usa su propio proyecto de Supabase. Puedes reutilizar la página pública de Capricorn en los pasos siguientes.

1. Crea un proyecto Supabase Free dedicado. En **SQL Editor**, pega y ejecuta la [migración del portal](supabase/migrations/202611230001_capricorn_portal.sql). La migración habilita RLS, separa los datos por editor y limita los envíos de cada enlace.
2. En **Authentication → Users**, crea la cuenta del editor con **Add user → Create new user**. Si el proyecto es solo para ti, desactiva el registro abierto.
3. Copia el identificador del proyecto desde su URL de Supabase, con el formato `https://IDENTIFICADOR.supabase.co`. En **Settings → API Keys**, copia la clave **Publishable key**, que empieza por `sb_publishable_`.
4. En **Capricorn → Ajustes → Portal de revisión**, pega el identificador y la clave publicable. Usa `https://andrypng1.github.io/capricorn/` como URL pública del portal, guarda la configuración e inicia sesión con la cuenta del paso 2.
5. En un proyecto ficticio, registra una entrega y abre **Compartir V1 y ver comentarios**. Crea un enlace, ábrelo en un navegador sin sesión, envía un comentario, actualiza el panel de Capricorn y añádelo como revisión. Revoca el enlace y comprueba que el navegador deja de poder enviar cambios.

Capricorn puede restaurar la sesión del editor si el almacenamiento cifrado de Windows está disponible. Los avisos se comprueban aproximadamente cada 45 segundos mientras la app está abierta y el editor tiene la sesión activa. Los clientes pueden comentar con Capricorn cerrado si Supabase está activo. El plan Free puede pausar proyectos con poca actividad y limita las cuotas de uso.

Si prefieres alojar tu propia página, publica exclusivamente `review-portal/` en un sitio estático HTTPS y usa esa URL en el paso 4.

Los recordatorios de cobro son locales. Se configuran desde Pagos → Presupuestos y aparecen en Agenda cuando entra el plazo de aviso configurado o cuando vencen. Un cobro liquidado desaparece de la lista. Los recordatorios y la configuración de conexión se guardan por equipo.
