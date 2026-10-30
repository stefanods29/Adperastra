# Copiar y mover archivos

Copia, mueve y cambia el nombre de archivos y carpetas con la barra de comandos, el menú contextual o el teclado. Todo funciona también con el Explorador de Windows: puedes copiar archivos aquí y pegarlos ahí, y al revés.

## Copiar y pegar

- Selecciona los elementos y elige **Copiar** (Ctrl+C) o **Cortar** (Ctrl+X).
- Abre la carpeta que quieras y elige **Pegar** (Ctrl+V).
- Los elementos cortados se mueven; los copiados se quedan donde estaban.
- Al pegar en la misma carpeta se crea una copia con un nombre como «report - Copy» (el nombre sigue el idioma de Windows).

## Cuando un nombre ya está ocupado

Si ya hay un elemento con el mismo nombre en la carpeta, se te pregunta qué hacer:

- **Combinar** (dos carpetas con el mismo nombre) agrega tus archivos a la carpeta existente y conserva los que ya están ahí. Los archivos con el mismo nombre se omiten y aparecen en la lista al terminar la operación.
- **Omitir** deja ambos como están.
- **Conservar ambos** mantiene el elemento existente y agrega el tuyo como «report - Copy» (luego «report - Copy (2)»). Un elemento movido que conserva ambos recibe un número, como «report (1)».

Marca **Hacer esto para todos los conflictos** para usar la misma respuesta en toda la operación. Nada se reemplaza ni se sobrescribe nunca. Un archivo y una carpeta con el mismo nombre no se pueden combinar; ese elemento se omite y aparece en la lista al terminar la operación. Reemplazar archivos llegará con la ventana de conflictos completa.

## Elementos nuevos

- **Nuevo** > **Nueva carpeta** (Ctrl+Shift+N) o **Nuevo** > **Documento de texto** crea un elemento vacío y abre su nombre listo para editar.
- Pulsa **Intro** para conservar el nombre o **Escape** para cancelar; el elemento se conserva, y puedes eliminarlo con **Eliminar** si no lo quieres.
- Cuando el nombre ya está ocupado, el elemento nuevo cuenta desde uno: «Nueva carpeta (1)», «Nueva carpeta (2)». Las descargas y los archivos pegados usan los mismos nombres numerados.

## Operaciones grandes

Copiar o mover mucho contenido se hace en segundo plano: un panel pequeño muestra el progreso, y puedes seguir trabajando o pulsar **Cancelar**. Cancelar nunca deja un archivo a medias, y los elementos que no se pudieron copiar (por ejemplo, porque otra app los está usando) se muestran al final.

Todo lo copiado y movido se puede deshacer: consulta «Deshacer».

Consulta también: «Eliminar y la Papelera de reciclaje», «Arrastrar y soltar» y «Pegar como archivo».

## Elementos del sistema y vínculos de carpetas

Mover, combinar con o eliminar un elemento del sistema de Windows, incluso uno dentro de una carpeta seleccionada, muestra una advertencia aparte antes de cambiar nada. **Cancelar** está seleccionado al principio. Elige **Continuar** solo si sabes que es seguro. Los demás archivos no necesitan esta confirmación adicional. Los archivos que no se cambian dentro de una carpeta combinada no provocan una advertencia.

Las raíces de las unidades y las carpetas Windows y Archivos de programa están protegidas. Si un movimiento o una eliminación contiene un vínculo o una unión de carpetas, se omite en lugar de seguir el vínculo. También se omite combinar con un elemento a través de uno de esos vínculos. El panel de operaciones muestra lo que se omitió; las copias normales conservan su protección contra ciclos de vínculos.
