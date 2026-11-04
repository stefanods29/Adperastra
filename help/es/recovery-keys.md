# Claves de recuperación

Conserva otra forma de descifrar el contenedor si olvidas su contraseña.

## Cómo usar

1. Guarda la clave al crear la copia cifrada. Es un archivo `.adprecovery` independiente.
2. Conserva ese archivo aparte y respáldalo de forma segura. No guardes la única copia dentro del contenedor.
3. Para recuperar el acceso, elige la opción de clave al desbloquear y selecciona el archivo.

## Para tener en cuenta

- Quien tenga la clave secreta puede descifrar el contenedor.
- La aplicación no puede restaurar una contraseña perdida sin una clave válida.
- El archivo de recuperación es JSON de texto sin cifrar con una clave secreta; la aplicación no lo cifra.
- Una clave pertenece a un solo contenedor. Se rechaza una clave de otro contenedor.

Consulta también: «Carpetas bloqueadas» y «Qué protege el bloqueo».
