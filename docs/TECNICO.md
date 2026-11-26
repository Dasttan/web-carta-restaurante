# Documentación técnica

## Cómo estaba y cómo queda
Antes: web estática (Vite, TypeScript, Preact) con los productos en JSON, sin servidor ni base de datos. Copia íntegra en `mis-webs/_copias/web-carta-restaurante_2026-11-25_antes-del-panel`.

| Carpeta | Contenido |
|---|---|
| `server/` | Servidor: base de datos, acceso, API, multimedia y mantenimiento |
| `src/admin/` | Panel. Se descarga aparte: la carta pública no lo carga |
| `src/` (resto) | Carta pública |
| `seed/` | Carta original. Solo se usa la primera vez, para crear la base de datos |
| `data/` | **Los datos vivos**: `carta.db`, `media/`, `copias/`. No va a Git |
| `tests/` | Pruebas automáticas, siempre en una carpeta temporal |

La base de datos es la única fuente: el servidor dibuja la carta con ella y la rehace tras cada cambio.

## Decisiones
- **React Admin** (5.15, licencia MIT): no se integra. Pide React, Material UI, Emotion, React Query, React Router y React Hook Form; aquí hay Preact y un solo recurso. Se siguen sus patrones: proveedor de datos y de acceso (`src/admin/api.ts`), lista con filtros, crear y editar.
- **Express + SQLite** (`better-sqlite3`): ligero, sin cuentas externas. Necesita disco persistente.
- **Contraseñas** con scrypt (N=65536, r=8, p=1). **Precios** en céntimos enteros.
- **Multimedia**: lo subido nunca se sirve tal cual. Las fotos se regeneran y los vídeos se recodifican con los mismos tamaños y calidad que los originales.
- **Extras**: ahora son productos de la categoría `extras`, con su grupo como subcategoría.
- **Edición simultánea**: si otra persona guardó antes, se avisa en vez de pisar sus cambios.
- **Categoría sin nada publicado**: no se enseña vacía; vuelve al publicar algo.

## Cambios en la parte pública
`Menu.tsx`, `TopBar.tsx` y `navigation.ts` leen los datos de otra variable (`.value`); `menu.ts` y `main.tsx` cambian el origen. Los estilos no se han tocado.

## API
Pública: `GET /api/products`, `GET /api/products/:slug`. Solo productos publicados.

Administración (`/api/admin`), con sesión y, al modificar, cabecera `X-CSRF-Token` y mismo origen: `login`, `logout`, `session`, `change-password`, `options`, `products`, `products/:id`, `products/:id/status`, `products/:id/move`, `media`, `media/:id`, `export`, `import`.

## Producción
Hace falta un servidor con Node 22.18 o superior y **disco persistente**. Un alojamiento estático (como Amplify) o uno sin disco **no sirve**. No se ha contratado ni publicado nada.

1. Copia el proyecto sin `node_modules`, `data` ni `.env`.
2. Crea `.env` desde `.env.example`: `ADMIN_PASSWORD` segura, `PUBLIC_ORIGIN=https://…`, `TRUST_PROXY=1` y `HOST=127.0.0.1` si hay un proxy delante, y `DATA_DIR` en el disco persistente.
3. `npm ci`, `npm run build` y `npm start`, con un gestor que lo mantenga encendido (systemd, pm2…).
4. Delante, un proxy con HTTPS (Caddy o Nginx) que admita subidas de 150 MB.
5. Programa `npm run copia` y guarda `data/copias` fuera del servidor.

En producción el servidor **se niega a arrancar** con la contraseña de desarrollo, con una débil o sin `PUBLIC_ORIGIN`. `ADMIN_PASSWORD` solo se usa al crear la cuenta; después puede borrarse de `.env`. Para llevar los datos de este ordenador al servidor, copia `data/` con el programa parado y ejecuta antes `npm run clave`.

## Contraseña olvidada
En el servidor, dentro del proyecto: `npm run clave`. La pide sin mostrarla, cierra las sesiones y desbloquea los intentos. No hay recuperación pública.

## Copias y restauración

| Copia | Qué incluye | Cómo |
|---|---|---|
| Panel | Productos (JSON) | Configuración de cuenta |
| Completa | Base de datos y multimedia | `npm run copia` |
| Automática | Productos antes de cada borrado; base de datos antes de restaurar | `data/copias` |

Restaurar una completa, con el servidor parado: `npm run restaurar -- <carpeta>`. Pide confirmación y guarda antes lo que había. No copies `carta.db` a mano con el servidor en marcha.

## Limitaciones
- Una sola cuenta y un solo proceso del servidor.
- Categorías, idiomas, datos del restaurante y lista de alérgenos no se cambian desde el panel.
- El archivo de una foto o vídeo sigue accesible para quien conozca su dirección exacta, aunque el producto esté oculto. Sus datos no.
- La copia JSON no lleva las fotos ni los vídeos.
- No se admiten fotos HEIC.

## Informe de pruebas (25/11/2026)
`npm test`: **37 de 37**, sobre el servidor real con datos temporales. Los números son los de la lista del encargo.

| Escenarios | Cómo | Resultado |
|---|---|---|
| 1 a 8. Acceso, contraseña, intentos, cierre | Automático; 1 a 3 también en Brave | Superado |
| 9 a 16. Crear, publicar, precio, textos, idiomas | Automático; crear, publicar y precio también en Brave | Superado |
| 17 a 19. Subir y sustituir foto y vídeo | Automático; subida también en Brave | Superado |
| 20 a 25. Ocultar y republicar | Automático; publicar también en Brave | Superado |
| 26 a 28. Orden, destacado, eliminar | Automático; orden y eliminar también en Brave | Superado |
| 29 a 32. Reinicio y API sin sesión | Automático | Superado |
| 33 a 35. Idiomas, categorías, vídeo | Brave | Superado |
| 36. Responsive | Brave: panel a 320, 375, 768 y 1354 px; carta a 652 y 1354 px | Superado |
| 37. Consola | Brave, en panel y carta | Sin errores |
| 38. Diseño público | HTML dibujado idéntico (35.942 caracteres) y hojas de estilo idénticas | Superado |
| 39 y 40. Productos originales | Automático, más comparación de los 4 JSON y la multimedia con la copia | Idénticos |

También se probó: CSRF, inyección SQL y XSS, archivos disfrazados, rotos o enormes, vídeos largos, edición simultánea, intentos en paralelo, importaciones manipuladas, arranque inseguro y recuperación de contraseña.

**Errores encontrados y corregidos**: un doble clic rápido creaba el producto dos veces; dos copias en el mismo segundo fallaban; el panel se desbordaba a 320 px.

**Sin probar**: teléfonos reales, Safari, Firefox, lector de pantalla, Linux y un despliegue con HTTPS. El cambio de contraseña y la restauración de copias se comprobaron por la API, no pulsando los botones del panel.
