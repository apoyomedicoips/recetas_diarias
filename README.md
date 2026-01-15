# Tablero IPS - Recetas diarias

Estructura mínima para publicar un tablero interactivo a partir de los CSV del repositorio `apoyomedicoips/recetas_diarias`.

## Contenido

- `index.html` — Página principal del tablero (para usar en GitHub Pages).
- `assets/styles.css` — Estilos personalizados (tema oscuro IPS).
- `assets/app.js` — Lógica de frontend, conexión con Google Apps Script.
- `gas/Code.gs` — Backend en Google Apps Script que lee los CSV desde GitHub y expone una API JSON.
- `usuarios.csv` — Ejemplo de archivo de usuarios para autenticación (`usuario,correo,clave,nombre,rol`).

## Pasos básicos

1. Crear un proyecto de Apps Script y copiar el contenido de `gas/Code.gs`.
2. Ajustar en `Code.gs` la constante `REPO_RAW_BASE` si el repositorio o rama cambian.
3. Publicar el Web App (ejecutar como usted, acceso: cualquiera con el enlace).
4. En `assets/app.js`, reemplazar:
   - `REEMPLAZAR_CON_ID` por el ID del Web App (`/exec`).
   - `REEMPLAZAR_RUTA` por la URL real del logo en Postimages.
5. Subir estos archivos a la raíz del repositorio GitHub (junto con los CSV) y activar GitHub Pages desde la rama `main`.
6. Asegurarse de tener un archivo `usuarios.csv` en el repositorio (mismo formato que el ejemplo).

