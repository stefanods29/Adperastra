# Abrir y extraer archivos comprimidos

Los archivos comprimidos guardan muchos archivos y carpetas en uno solo: archivos ZIP, 7z, TAR (también .tar.gz, .tar.xz y .tar.bz2), gzip (.gz), xz (.xz), bzip2 (.bz2, .tbz, .tbz2) y RAR. Adperastra los abre como carpetas y los extrae de forma segura.

## Ver el contenido de un archivo comprimido

1. Haz doble clic en un archivo comprimido. Se abre en su propia pestaña y muestra sus carpetas y archivos.
2. Haz doble clic en una carpeta para abrirla. Usa la ruta de arriba, **Subir un nivel** o **Retroceso** para volver.
3. Escribe en el cuadro de búsqueda de arriba a la derecha para encontrar archivos en cualquier parte del archivo comprimido. **Abrir ubicación del elemento** muestra dónde está un archivo encontrado.

## Abrir un archivo de adentro

Haz doble clic en un archivo (o selecciónalo y presiona **Entrar**). Adperastra lo copia por su cuenta y lo abre en una pestaña nueva. Esa copia es de solo lectura: para conservar los cambios, usa **Guardar como** y elige una carpeta.

## Extraer

- **Extraer todo** (en la pestaña del archivo comprimido, o en la barra de comandos cuando hay uno seleccionado): crea una carpeta nueva con el nombre del archivo comprimido, junto a él, y pone todo adentro.
- Clic con el botón derecho en un archivo comprimido > **Extraer** > **Extraer aquí**: pone el contenido en la carpeta del archivo comprimido.
- Clic con el botón derecho > **Extraer** > **Extraer en…**: elige una carpeta; adentro se crea una carpeta nueva con el nombre del archivo comprimido.
- En la pestaña del archivo comprimido, selecciona elementos y haz clic en **Extraer lo seleccionado…**: elige una carpeta; los elementos seleccionados van directamente a ella.

La extracción se hace en segundo plano: el panel Operaciones de archivo muestra el progreso y tiene **Cancelar**. Al terminar, los elementos nuevos quedan seleccionados y **Deshacer (Ctrl+Z)** los envía a la Papelera de reciclaje.

## Para tener en cuenta

- Extraer nunca reemplaza nada. Si ya hay un archivo o una carpeta con el mismo nombre, el nuevo recibe un número, como «informe (1).txt».
- Los elementos cuyo nombre podría escribir fuera de la carpeta, o que Windows no permite, se ocultan y nunca se extraen. Los vínculos dentro de los archivos comprimidos se muestran, pero nunca se extraen.
- Un archivo comprimido que ocuparía muchísimo más espacio que su tamaño (una «bomba zip»), o que no cabe en la unidad, se rechaza antes de escribir nada.
- Los archivos ZIP y 7z protegidos con contraseña la piden y pueden recordarla hasta que se cierre la aplicación. Consulta «Contraseñas de archivos comprimidos».
- RAR usa un 7-Zip que instalas tú desde 7-zip.org; no se incluye. Se rechazan los archivos RAR divididos en partes, autoextraíbles, con enlaces o ambiguos, y no se ofrece crear RAR.
- Si el archivo comprimido vino de Internet, los archivos que extraigas o abras conservan esa marca y se abren en vista protegida.
- Los archivos comprimidos se leen en un proceso aparte y limitado, así que uno dañado no puede bloquear Adperastra.

Consulta también: «Crear archivos comprimidos», «Contraseñas de archivos comprimidos», «Abrir archivos en pestañas», «Copiar y mover archivos» y «Deshacer».
