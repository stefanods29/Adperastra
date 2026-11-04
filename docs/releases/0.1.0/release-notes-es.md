# Adperastra 0.1.0

> **Borrador: no publicar todavía.** Este archivo se prepara para la primera
> revisión de la versión. Se hace público solo cuando
> `docs/releases/0.1.0/acceptance.md` registra pruebas aprobadas y no queda
> ningún Bloqueante ni Grave abierto.

## Lo que esta versión tiene previsto incluir

- Pestañas del Explorador, Inicio, navegación de carpetas, selección, Panel de
  detalles y el registro de comandos.
- Operaciones de archivos seguras con progreso, Cancelar y Deshacer, incluida
  la Papelera de reciclaje, arrastrar y soltar y Pegar como archivo.
- Visores integrados para texto, código, Markdown, imágenes, audio y video,
  archivos comprimidos, tablas, JSON, fuentes, PDF, libros electrónicos,
  cuadernos, correo, subtítulos, registros, tablas SQLite, modelos 3D, RAW de
  cámara, HEIC/AVIF y PSD.
- Edición de texto con Guardar y Guardar como, historial de versiones y
  plantillas en el menú Nuevo.
- Creación de archivos comprimidos con contraseñas y lectura opcional de RAR
  mediante un 7-Zip instalado aparte.
- Reconocimiento de texto local, vista previa rápida, detalles enriquecidos,
  Galería, conversión, ajustes por lotes y limpieza opcional de información
  privada.
- Búsqueda opcional de actualizaciones. Nada se descarga ni se instala
  automáticamente.

## Formatos y límites

El coordinador añade aquí los formatos probados y los límites actuales a
partir de las pruebas de aceptación antes de publicar. La ayuda de la
aplicación describe los visores compatibles. Los archivos no compatibles se
abren en su aplicación de Windows. Los archivos muy grandes o dañados pueden
rechazarse con un mensaje en lugar de mostrarse.

## Instalar y verificar

Descarga `Adperastra-0.1.0-windows-x64-setup.exe` o
`Adperastra-0.1.0-windows-x64-portable.zip` junto con `SHA256SUMS.txt`.
Verifica la suma de comprobación antes de ejecutar nada. El instalador es por
usuario y no necesita administrador. Conserva la configuración y los datos al
actualizar; al desinstalar, los conserva de forma predeterminada.

Esta versión no tiene firma de código. Windows puede mostrar «Windows protegió
su PC». Elige «Más información» y «Ejecutar de todas formas» solo cuando la
suma coincida.

## Puertas de la versión aún abiertas en este borrador

Los siguientes problemas abiertos deben resolverse o trasladarse con una
decisión revisada antes de publicar: KI-069, KI-075, KI-087, KI-033 y KI-037.
La compatibilidad con RAR no debe describirse como verificada sin la prueba
aparte del runtime de 7-Zip (KI-081). Cualquier afirmación de este borrador es
un plan, no una prueba observada.

## Licencia

Adperastra tiene licencia MIT. Los componentes de terceros y los enlaces al
código fuente están en `THIRD_PARTY_LICENSES.txt` y `SOURCE-NOTICES.txt`.
