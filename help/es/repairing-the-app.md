# Reparar la aplicación

Si Adperastra no se inicia, o un componente necesario fue eliminado o dañado, ejecuta el programa de instalación con la opción de reparación:

    AdperastraSetup.exe --repair

Comprueba cada componente requerido contra la lista firmada en dependencies.json, reinstala solo lo que falta o está dañado (verificando la suma de comprobación antes de usarlo) y luego inicia la aplicación. Si no tienes conexión, te dice qué falta y cómo obtenerlo.

Tu configuración, tus archivos y las elecciones del primer uso no se modifican con una reparación.
