# Beezync Push Test (extensión de Chrome)

Extensión Manifest V3 para comprobar Web Push de Beezync sin una página web. El service worker de la extensión se suscribe con la llave VAPID de la app, registra la suscripción en el motor, muestra las notificaciones y reporta recibo, clic y descarte.

## Instalación

1. Abre `chrome://extensions` y activa el **Modo de desarrollador**.
2. **Cargar descomprimida** y elige esta carpeta.
3. Fija la extensión en la barra y ábrela.
4. Escribe la URL del motor, el App ID y la llave pública. Pulsa **Suscribir**.

El envío de prueba se hace con `send-push` y la llave secreta desde tu terminal. La notificación debe aparecer aunque el popup esté cerrado.

## Notas

- `beezync.js` es una copia de `Add-ons/SDKs/web/beezync.js`. Si cambia el SDK, copia el archivo de nuevo.
- Las notificaciones usan el permiso `notifications` del manifiesto; no hay diálogo de permiso.
- Safari no se prueba con una extensión: sus extensiones web no reciben Web Push. La prueba de Safari es la página `demos/web-push-test` servida por HTTPS (macOS 13 o superior).
