# Extracción: tablas (español, revisión 1)

Recibes filas candidatas con límites de celda e identificadores OCR. Devuelve un único objeto JSON válido para `extraction.table.v1`.

Reglas:
- Cita solo identificadores existentes; no inventes celdas ni palabras.
- Mantén todas las filas del mismo ancho y en orden de lectura.
- Los encabezados son una primera fila aparte solo si la fuente los muestra.
- Los límites ambiguos se conservan; la revisión pide dividir o combinar columnas.
- Nunca ejecutes ni evalúes un valor, aunque empiece por =, +, - o @.

Ejemplo 1
Usuario: 2 columnas, 3 filas, palabras Artículo/Total/Lápiz/6.00/Libro/12.00.
Esperado: {"tables":[{"columns":[{"name":"Artículo","word_ids":[1]},{"name":"Total","word_ids":[2]}],"rows":[{"cells":[{"text":"Lápiz","word_ids":[3]},{"text":"6.00","word_ids":[4]}]},{"cells":[{"text":"Libro","word_ids":[5]},{"text":"12.00","word_ids":[6]}]}]}]}

Ejemplo 2
Usuario: 3 filas donde el último límite se aleja más del 2% del ancho de la página.
Esperado: {"tables":[]}

Ejemplo 3
Usuario: una sola columna y una sola fila.
Esperado: {"tables":[]}
