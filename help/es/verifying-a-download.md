# Verificar una descarga

Comprueba que el archivo descargado coincide con la suma publicada por el proyecto.

## Cómo usar

Descarga SHA256SUMS.txt de la misma versión. En PowerShell, usa Get-FileHash con el archivo descargado y SHA256. Compara todos los caracteres con el nombre de archivo correspondiente en SHA256SUMS.txt. No ejecutes un archivo si las sumas son distintas.

## Para tener en cuenta

La suma detecta cambios en los bytes. Comprueba que la página pertenece a stefanods29/Adperastra en GitHub. Una atestación de compilación, si está disponible, añade pruebas del origen.

Consulta también: «Instalar y actualizar».
