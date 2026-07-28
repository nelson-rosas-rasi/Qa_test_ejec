# Despliegue del backend para el piloto — Diseño

**Fecha:** 2026-07-27
**Estado:** aprobado
**Repos afectados:** `ReportRas_Backe` (Spring Boot) y `Qa_test_ejec/electron-app` (RunQA)

## Objetivo

Que RunQA, corriendo en la máquina de un analista, reporte sus corridas por HTTPS
a un backend accesible desde internet, sin costo y sin depender de que una máquina
de la oficina esté prendida.

El criterio de éxito es una sola frase: **un analista abre RunQA, inicia sesión
contra el dominio público, corre una prueba, y la corrida queda guardada en el
backend.**

## Alcance

Esto es un **piloto**. Los datos son de prueba y se pueden perder. No hay
compromiso de uptime ni de backups.

**Dentro:** ingesta de corridas (`POST /api/runs`), login (`POST /api/auth/login`),
sincronización del catálogo de módulos (`POST /api/sync/modules`).

**Fuera:** el panel web `Frontend_RasiReport`, la evidencia a Google Drive, el alta
de analistas desde la UI, y un dominio propio. Cada uno es trabajo de otra pieza
del roadmap.

## Arquitectura

```
RunQA (Electron, N máquinas)
        │  HTTPS + JWT
        ▼
Render Web Service (Docker, plan free)  ──►  Neon Postgres (plan free)
https://<servicio>.onrender.com              sslmode=require
```

Las tres piezas se conocen solo por configuración: Render llega a Neon por una
cadena de conexión en variable de entorno, y RunQA llega a Render por una URL
guardada en settings. Migrar a un plan pago o a un servidor de la empresa es
cambiar esos dos valores.

### Por qué Render + Neon

Se descartaron las alternativas por hechos verificados el 2026-07-27:

- **Fly.io** eliminó su free tier en 2024; hoy da un trial de 2 horas de VM o 7 días.
- **Koyeb** cerró su plan Starter gratuito a usuarios nuevos tras la compra por Mistral.
- **El Postgres gratuito de Render expira a los 30 días** y se borra tras 14 días de
  gracia. Por eso la base va en **Neon**, cuyo plan gratuito no vence (0.5 GB,
  100 horas-cómputo/mes, scale-to-zero, sin tarjeta).
- **Oracle Cloud Always Free** da una VM siempre despierta, pero el montaje (VM,
  nginx, certbot, firewall) es desproporcionado para un piloto y la aprobación de
  cuenta suele fallar en Colombia.

El servicio gratuito de Render duerme a los 15 minutos de inactividad y tarda cerca
de un minuto en despertar. **Esto es tolerable por una propiedad que el cliente ya
tiene:** `main/server/queue.js` y `sender.js` implementan una cola durable en disco
que reintenta ante errores de red, así que una corrida contra un servidor dormido se
encola y se entrega sola. El único que espera el arranque en frío es el login, una
vez al día.

## Cambios en el backend

Siete cambios de configuración y arranque. **Ninguno toca la lógica de ingesta**
ya implementada y revisada en `d882c79..1c8abdd`.

### a. Dockerfile multi-stage

Render no ofrece runtime nativo de Java, así que el servicio se despliega como
imagen Docker: `maven:3.9-eclipse-temurin-17` para compilar (el `pom.xml` fija
`java.version` en 17), `eclipse-temurin:17-jre` para ejecutar.

Efecto lateral deseable: el build usa el JDK de la imagen, así que deja de importar
que el `javac` del sistema sea Java 8 y ya no hace falta exportar `JAVA_HOME`
apuntando a `~/.jdks/jdk-21.0.12+8`.

### b. Puerto desde el entorno

`server.port` pasa de `8080` fijo a `${PORT:8080}`. Render inyecta `PORT` y termina
el contenedor si la aplicación no escucha ahí. El default conserva el comportamiento
local.

### c. Datasource desde el entorno

**No requiere cambiar el código.** `spring.datasource.url` está fijo en
`jdbc:postgresql://localhost:5432/qa_reports_db`, pero Spring Boot da precedencia a
las variables de entorno sobre `application.yml`: definir `SPRING_DATASOURCE_URL` en
Render sobreescribe ese valor sin tocar el archivo. Reescribirlo como
`${SPRING_DATASOURCE_URL:...}` sería puramente cosmético y no se hace.

El usuario y la contraseña ya se leen de `DB_USERNAME` y `DB_PASSWORD`.

Lo que sí exige atención es el formato: Neon entrega una URI
(`postgresql://usuario:password@host/db?sslmode=require`) que Spring no acepta tal
cual. Hay que anteponer `jdbc:`, quitar las credenciales embebidas y pasarlas como
variables aparte, conservando `?sslmode=require`.

### d. Google Drive no debe impedir el arranque

**Problema:** `GoogleDriveConfig` construye el bean `Drive` leyendo
`classpath:google-credentials.json`. Ese archivo no existe en el repositorio y el
`@Bean` declara `throws IOException`, así que Spring aborta el arranque. Como
`GoogleDriveService` recibe `Drive` por constructor y `QaModuleServiceImpl` recibe
`GoogleDriveService`, quitar el bean rompe la cadena de inyección hasta el
controlador.

La suite pasa 28/28 porque `GoogleDriveConfig` está anotada `@Profile("!test")` y el
perfil de test provee un mock. Es decir: **los tests nunca ejercitaron el arranque
real**, y hasta donde indica el repositorio la aplicación nunca se levantó fuera de
ellos.

**Solución:** cuando el recurso de credenciales no existe, `GoogleDriveConfig`
registra un warning y devuelve un `Drive` construido sin credenciales, en lugar de
lanzar. El bean existe, la cadena de inyección queda intacta y **no se modifica
`GoogleDriveService` ni `QaModuleServiceImpl`**. Solo fallan las llamadas reales a
Drive, que en el piloto no ocurren porque `POST /api/runs` no toca ese servicio.

La versión arquitectónicamente correcta —bean condicional más `ObjectProvider<Drive>`
en el servicio— corresponde a la pieza F del roadmap, cuando Drive entre en alcance.

### e. `JWT_SECRET` obligatorio

`application.yml` trae hoy la clave de firma como valor por defecto, y ese archivo
está commiteado en un repositorio de GitHub. Contra un backend expuesto a internet,
cualquiera que lea el repositorio puede firmar tokens válidos y hacerse pasar por un
`QA_LEAD`.

La propiedad pasa a exigir la variable de entorno sin default: si `JWT_SECRET` no
está definida, la aplicación no arranca. El valor nuevo se genera con
`openssl rand -base64 48` y se carga como secreto en Render, nunca en un archivo del
repositorio. El valor viejo queda en el historial de git, pero deja de servir.

El algoritmo de firma es HMAC-SHA (jjwt 0.12.5), que exige una clave de al menos 256
bits; 48 bytes en base64 la supera con margen.

### f. Password del admin desde el entorno

`DataInitializer` siembra el usuario `admin` con la contraseña `Admin2026!` escrita
en el código fuente, también publicada en GitHub. Pasa a leerse de `ADMIN_PASSWORD`
sin valor por defecto, con el mismo criterio que el punto anterior.

El seed sigue siendo condicional (`if (!userRepository.existsByUsername("admin"))`),
así que reiniciar el servicio no pisa la contraseña de un admin ya existente.

### g. Endpoint de salud público

`GET /api/health` devuelve 200 sin autenticación. Cumple dos funciones: verificar que
el despliegue quedó bien sin necesidad de credenciales, y darle a RunQA una llamada
barata para despertar el servicio antes de mostrar el login.

Requiere una línea en `SecurityConfig`, junto al `permitAll()` que ya tiene
`POST /api/auth/login`.

### Lo que no cambia

**CORS.** El `fetch` del proceso main de Electron no envía cabecera `Origin`, así que
la configuración de CORS es irrelevante para la ingesta. Solo importará al desplegar
el panel web.

## Cambios en el cliente Electron

### a. URL por defecto

`DEFAULT_SERVER_URL` en `main/ipc.js:63` pasa de `http://localhost:8080` a la URL de
Render, para que un analista que instale el `.exe` no tenga que configurar nada.

### b. Campo "Servidor" en Configuración

Las IPC `config:getServerUrl` y `config:setServerUrl` existen en `main/ipc.js:263-266`
y están expuestas en `preload.js:73-74`, pero **ninguna pantalla las usa**: hoy no hay
forma de apuntar RunQA a otro servidor sin recompilar.

Se agrega un input en la pantalla de Configuración, junto al del webhook de n8n
(`renderer/renderer.js:1488`), siguiendo el mismo patrón visual. Con eso el mismo
instalador sirve para apuntar a Render o a un backend local.

### c. Aviso de arranque en frío

La pantalla de login muestra un texto advirtiendo que el primer ingreso del día puede
tardar hasta un minuto mientras el servidor despierta. Sin esto, un login que tarda 60
segundos se lee como una aplicación colgada.

## Datos

La base de Neon nace vacía: `ddl-auto: update` crea el esquema y `DataInitializer`
siembra el admin en el primer arranque.

**El script `migrations/2026-07-24-project-e-ingesta.sql` no se ejecuta.** Existe para
bases que ya tenían datos bajo el esquema anterior (`project_type DROP NOT NULL` más
backfill); una base nueva no lo necesita.

## Riesgos aceptados

- **El servicio duerme a los 15 minutos** y tarda ~1 minuto en despertar. Mitigado por
  la cola durable del cliente; el costo recae solo en el login.
- **512 MB de RAM** son ajustados para Spring Boot 3.2 con JPA y el cliente de Google
  API. Se fija `JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=70`. Si el contenedor muere por
  falta de memoria, esa es la señal de que el piloto necesita un plan pago.
- **Sin backups.** El plan gratuito de Neon no los ofrece, lo cual es coherente con
  datos de prueba desechables.
- **0.5 GB de almacenamiento** en Neon. Suficiente para corridas de un piloto, que son
  filas de texto y métricas.
- **`ddl-auto: update` se mantiene.** Migrarlo a Flyway corresponde a cuando esto deje
  de ser un piloto.
- **El JWT secret y la contraseña viejos quedan en el historial de git.** Se rotan, no
  se borran del historial; reescribir la historia no aporta valor porque los valores
  nuevos nunca se commitean.

## Verificación

**No existe un endpoint de lectura de corridas.** `IngestController` expone solo
`POST /api/runs`; el único GET de lectura del backend es `/api/modules/stats`.
Construir un `GET /api/runs` es trabajo de la pieza D del roadmap, cuando el panel
web necesite listarlas. Para el piloto, la verificación se hace contra la base.

El piloto se da por bueno cuando, desde una máquina que no es la de desarrollo:

1. `GET https://<servicio>.onrender.com/api/health` responde 200.
2. RunQA inicia sesión contra ese dominio con el admin y la contraseña nueva.
3. Una prueba ejecutada en RunQA aparece como fila en `test_runs`, consultada
   desde el editor SQL de la consola de Neon.
4. `GET /api/modules/stats`, autenticado con el token del login, refleja el
   coverage recalculado por esa corrida.
5. Con el servicio dormido, una corrida ejecutada queda encolada y se entrega sola
   cuando el servidor despierta.
