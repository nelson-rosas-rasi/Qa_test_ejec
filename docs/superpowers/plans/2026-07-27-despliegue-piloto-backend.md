# Despliegue del backend para el piloto — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que RunQA, instalado en la máquina de un analista, reporte sus corridas por HTTPS a un backend Spring Boot desplegado gratis en Render con la base en Neon.

**Architecture:** Cinco cambios de configuración y arranque en el repositorio del backend (que hoy **no puede levantarse fuera de los tests**), un despliegue manual de infraestructura que produce la URL pública, y tres cambios en el cliente Electron para apuntarlo a esa URL. Ninguna tarea toca la lógica de ingesta ya revisada.

**Tech Stack:** Spring Boot 3.2.5 / Java 17, PostgreSQL (Neon), Docker (Render), Electron + `node:test`.

## Global Constraints

- El spec es [2026-07-27-despliegue-piloto-backend-design.md](../specs/2026-07-27-despliegue-piloto-backend-design.md).
- **Dos repositorios distintos.** Las tareas 1–5 se ejecutan en `~/Escritorio/Proyectos /SpringComuTestQa/ReportRas_Backe`. La tarea 7 se ejecuta en `~/Escritorio/Proyectos /TestQA/Qa_test_ejec/electron-app`. La tarea 6 no toca código. Nótese el **espacio en `Proyectos /`**: las rutas deben ir entre comillas.
- **`JAVA_HOME` es obligatorio para TODO comando Maven de este plan:**

  ```bash
  export JAVA_HOME=~/.jdks/jdk-21.0.12+8
  ```

  Sin esto, cualquier compilación desde cero falla con `release version 17 not
  supported`. La causa: `/usr/lib/jvm/java-21-openjdk-amd64` —el JVM sobre el que
  arranca Maven— **es un JRE sin `javac`**, así que el plugin de compilación delega
  en `/usr/bin/javac`, que es Java 8. El JDK completo está en `~/.jdks/jdk-21.0.12+8`.
  Un `mvn test` puede *parecer* que funciona sin esta variable si el `target/` ya
  tiene clases compiladas de antes: no recompila y no falla. Eso es un falso verde.

- **Líneas base verificadas el 2026-07-27 desde una compilación limpia:** backend `mvn test` = **28/28**, cliente `npm test` = **224/224**. Este plan agrega 3 tests al backend (28 → 31) y ninguno al cliente.
- **Commits sí, push no.** Las tareas 1–5 se implementan en un worktree aislado sobre la rama `despliegue-piloto` (creada el 2026-07-27 desde `1c8abdd`), en
  `~/Escritorio/Proyectos /SpringComuTestQa/.worktrees-ReportRas_Backe/despliegue-piloto`.
  Commitear en esa rama está autorizado y es necesario para el flujo de revisión.
  **Mezclar a `main` y pushear a GitHub NO lo está**: es decisión del usuario y es el
  requisito previo de la Task 6.
- **El daemon de Docker no está disponible en esta máquina** (el usuario no pertenece al grupo `docker`, el servicio está inactivo y no hay socket). El Dockerfile **no se puede construir ni probar localmente**; se verifica en el log de build de Render.
- Todo el copy de la UI y los mensajes de log en español neutro, igual que el resto de ambos repositorios.
- No agregar dependencias nuevas a `pom.xml` ni a `package.json`.

---

### Task 1: Que la ausencia de credenciales de Drive no impida arrancar

**Files:**
- Create: `src/test/java/com/royalnet/qareports/config/GoogleDriveConfigTest.java`
- Modify: `src/main/java/com/royalnet/qareports/config/GoogleDriveConfig.java`

**Interfaces:**
- Consumes: nada.
- Produces: `GoogleDriveConfig.googleDriveService()` conserva su firma exacta —
  `public Drive googleDriveService() throws GeneralSecurityException, IOException`—
  y sigue devolviendo un `Drive` no nulo. Ninguna otra tarea la consume, pero
  `GoogleDriveService` y `QaModuleServiceImpl` dependen de que el bean exista.

**Contexto:** `GoogleDriveConfig` construye el bean `Drive` leyendo `classpath:google-credentials.json`. Ese archivo **no existe en el repositorio** y el método declara `throws IOException`, así que Spring aborta el arranque. La suite pasa solo porque la clase está anotada `@Profile("!test")` y `TestSupport` inyecta un mock; su propio comentario ya lo documenta. Como `GoogleDriveService` recibe `Drive` por constructor y `QaModuleServiceImpl` recibe `GoogleDriveService`, **eliminar el bean rompería la cadena de inyección hasta el controlador**, por eso la solución es devolver un `Drive` sin credenciales en vez de no registrarlo.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/test/java/com/royalnet/qareports/config/GoogleDriveConfigTest.java`:

```java
package com.royalnet.qareports.config;

import com.google.api.services.drive.Drive;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * El bean Drive tiene que existir aunque no haya credenciales: sin él, la cadena
 * GoogleDriveService -> QaModuleServiceImpl -> ModuleController deja de inyectarse
 * y la aplicación no arranca en ningún entorno que no sea el perfil de test.
 */
class GoogleDriveConfigTest {

    @Test
    void sinArchivoDeCredencialesDevuelveUnDriveEnVezDeLanzar() throws Exception {
        GoogleDriveConfig config = new GoogleDriveConfig();
        ReflectionTestUtils.setField(config, "credentialsResource",
                new ClassPathResource("no-existe-google-credentials.json"));

        Drive drive = config.googleDriveService();

        assertThat(drive).isNotNull();
    }
}
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `mvn -q test -Dtest=GoogleDriveConfigTest`
Expected: FALLA con `FileNotFoundException` (subclase de `IOException`) al intentar `credentialsResource.getInputStream()`.

- [ ] **Step 3: Implementar el cambio mínimo**

En `src/main/java/com/royalnet/qareports/config/GoogleDriveConfig.java`, agregar la anotación `@Slf4j` a la clase, agregar el import `com.google.api.client.http.HttpRequestInitializer` y `lombok.extern.slf4j.Slf4j`, y reemplazar el cuerpo del método `googleDriveService()` por:

```java
    @Bean
    public Drive googleDriveService() throws GeneralSecurityException, IOException {
        HttpRequestInitializer initializer = null;

        if (credentialsResource != null && credentialsResource.exists()) {
            GoogleCredentials credentials = GoogleCredentials
                    .fromStream(credentialsResource.getInputStream())
                    .createScoped(List.of(DriveScopes.DRIVE));
            initializer = new HttpCredentialsAdapter(credentials);
        } else {
            log.warn("Sin credenciales de Google Drive: el cliente queda sin autenticar y "
                    + "cualquier operación contra Drive fallará. La ingesta de corridas no lo usa.");
        }

        return new Drive.Builder(
                GoogleNetHttpTransport.newTrustedTransport(),
                GsonFactory.getDefaultInstance(),
                initializer)
                .setApplicationName("QA Reports - ROYALNET")
                .build();
    }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `mvn -q test -Dtest=GoogleDriveConfigTest`
Expected: PASA.

- [ ] **Step 5: Correr la suite completa**

Run: `mvn test`
Expected: **29 tests, 0 failures** (los 28 de la línea base más el nuevo).

- [ ] **Step 6: Commit** *(solo si el usuario lo autorizó — ver Global Constraints)*

```bash
git add src/main/java/com/royalnet/qareports/config/GoogleDriveConfig.java src/test/java/com/royalnet/qareports/config/GoogleDriveConfigTest.java
git commit -m "fix(drive): la falta de credenciales ya no impide arrancar la aplicación"
```

---

### Task 2: Puerto configurable desde el entorno

**Files:**
- Modify: `src/main/resources/application.yml:1-2`

**Interfaces:**
- Consumes: nada.
- Produces: la aplicación escucha en `$PORT` si la variable existe, en 8080 si no.
  La tarea 6 depende de esto para que Render no mate el contenedor.

**Contexto:** Render inyecta la variable `PORT` y termina el contenedor si la aplicación no escucha ahí. `server.port` está hoy fijo en `8080`.

Este cambio **no lleva test propio**: verificarlo requeriría levantar el servidor en un puerto y comprobarlo, lo que en `@SpringBootTest` con `MockMvc` (el patrón del repositorio) no aplica. Se verifica con un arranque real en el Step 2 y la suite queda como regresión.

**Nota sobre el datasource:** el spec menciona hacer explícito `spring.datasource.url`. **No se cambia.** Spring Boot ya da precedencia a las variables de entorno sobre `application.yml`, así que definir `SPRING_DATASOURCE_URL` en Render sobreescribe el valor local sin tocar el archivo. Agregar `${SPRING_DATASOURCE_URL:...}` sería puramente cosmético y este plan no lo hace.

- [ ] **Step 1: Editar el puerto**

En `src/main/resources/application.yml`, reemplazar:

```yaml
server:
  port: 8080
```

por:

```yaml
server:
  # Render (y la mayoría de PaaS) inyectan el puerto por la variable PORT.
  port: ${PORT:8080}
```

- [ ] **Step 2: Verificar que el override funciona**

Run: `PORT=9099 mvn spring-boot:run`
Expected: en el log aparece `Tomcat started on port 9099`. Cortar con Ctrl+C.

Si la aplicación falla antes por la base de datos, es esperado en una máquina sin PostgreSQL levantado: alcanza con ver la línea de Tomcat, que se emite antes.

- [ ] **Step 3: Correr la suite completa**

Run: `mvn test`
Expected: **29 tests, 0 failures**.

- [ ] **Step 4: Commit** *(solo si el usuario lo autorizó)*

```bash
git add src/main/resources/application.yml
git commit -m "chore(config): tomar el puerto de la variable PORT para desplegar en PaaS"
```

---

### Task 3: Secretos obligatorios por entorno

**Files:**
- Create: `src/test/java/com/royalnet/qareports/config/DataInitializerTest.java`
- Modify: `src/main/resources/application.yml`
- Modify: `src/test/resources/application-test.yml`
- Modify: `src/main/java/com/royalnet/qareports/config/DataInitializer.java`

**Interfaces:**
- Consumes: nada.
- Produces: dos propiedades nuevas de configuración, `app.jwt.secret` (ya existía, ahora
  sin default) y `app.admin.password` (nueva, sin default). La tarea 6 debe definir
  `JWT_SECRET` y `ADMIN_PASSWORD` en Render o el arranque falla.

**Contexto:** `application.yml` trae la clave de firma JWT como valor por defecto y `DataInitializer` tiene `Admin2026!` escrita en el código. Ambos archivos están commiteados en un repositorio de GitHub; contra un backend expuesto a internet, cualquiera que los lea puede firmar tokens de `QA_LEAD` o entrar como admin.

**Trampa verificada:** `DataInitializer` es un `CommandLineRunner` y **sí se ejecuta durante los `@SpringBootTest`** (en el log de la suite aparece `Usuario admin creado`). Por eso `application-test.yml` tiene que definir `app.admin.password`, o las 29 pruebas fallan al arrancar el contexto. `app.jwt.secret` ya está definido ahí, así que quitar su default no rompe nada.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/test/java/com/royalnet/qareports/config/DataInitializerTest.java`:

```java
package com.royalnet.qareports.config;

import com.royalnet.qareports.TestSupport;
import com.royalnet.qareports.entity.User;
import com.royalnet.qareports.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
@Import(TestSupport.class)
class DataInitializerTest {

    @Autowired private UserRepository userRepository;
    @Autowired private PasswordEncoder passwordEncoder;

    @Value("${app.admin.password}") private String adminPassword;

    @Test
    void elAdminSeSiembraConLaPasswordConfigurada() {
        User admin = userRepository.findByUsername("admin").orElseThrow();

        assertThat(passwordEncoder.matches(adminPassword, admin.getPassword())).isTrue();
    }
}
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `mvn -q test -Dtest=DataInitializerTest`
Expected: FALLA al arrancar el contexto, porque `app.admin.password` todavía no existe como propiedad (`IllegalArgumentException: Could not resolve placeholder 'app.admin.password'`).

- [ ] **Step 3: Definir la propiedad en el perfil de test**

En `src/test/resources/application-test.yml`, dentro del bloque `app:` que ya existe, agregar la clave `admin` como hermana de `jwt`, dejando el bloque así:

```yaml
app:
  jwt:
    secret: test-secret-key-qa-reports-royalnet-muy-larga-para-hmac-sha
    expiration-ms: 86400000
  admin:
    password: test-admin-password
```

- [ ] **Step 4: Quitar los defaults en la configuración principal**

En `src/main/resources/application.yml`, reemplazar el bloque:

```yaml
# JWT
app:
  jwt:
    secret: ${JWT_SECRET:qa-reports-secret-key-royalnet-2026-very-long-secure-string}
    expiration-ms: 86400000   # 24 horas
```

por:

```yaml
# JWT y credenciales de arranque. Sin default a propósito: si estas variables no
# están definidas la aplicación no arranca, para que un despliegue expuesto a
# internet nunca quede con los valores que están publicados en el historial de git.
app:
  jwt:
    secret: ${JWT_SECRET}
    expiration-ms: 86400000   # 24 horas
  admin:
    password: ${ADMIN_PASSWORD}
```

- [ ] **Step 5: Leer la password desde la configuración**

En `src/main/java/com/royalnet/qareports/config/DataInitializer.java`, agregar el import `org.springframework.beans.factory.annotation.Value`, agregar el campo:

```java
    @Value("${app.admin.password}")
    private String adminPassword;
```

y reemplazar en el método `run`:

```java
                    .password(passwordEncoder.encode("Admin2026!"))
```

por:

```java
                    .password(passwordEncoder.encode(adminPassword))
```

Reemplazar además la línea de log, que hoy imprime la contraseña en claro:

```java
            log.info("Usuario admin creado — user: admin / pass: Admin2026!");
```

por:

```java
            log.info("Usuario admin creado — user: admin (contraseña tomada de ADMIN_PASSWORD)");
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `mvn -q test -Dtest=DataInitializerTest`
Expected: PASA.

- [ ] **Step 7: Correr la suite completa**

Run: `mvn test`
Expected: **30 tests, 0 failures**.

- [ ] **Step 8: Verificar que sin las variables la aplicación no arranca**

Run: `mvn spring-boot:run`
Expected: FALLA con `Could not resolve placeholder 'JWT_SECRET'`. Este fallo es el comportamiento buscado.

A partir de acá, correr el backend localmente exige exportar las dos variables, por ejemplo:

```bash
export JWT_SECRET="$(openssl rand -base64 48)"
export ADMIN_PASSWORD='una-password-local'
```

- [ ] **Step 9: Commit** *(solo si el usuario lo autorizó)*

```bash
git add src/main/resources/application.yml src/test/resources/application-test.yml src/main/java/com/royalnet/qareports/config/DataInitializer.java src/test/java/com/royalnet/qareports/config/DataInitializerTest.java
git commit -m "fix(security): exigir JWT_SECRET y ADMIN_PASSWORD por entorno, sin defaults publicados"
```

---

### Task 4: Endpoint de salud público

**Files:**
- Create: `src/main/java/com/royalnet/qareports/controller/HealthController.java`
- Modify: `src/main/java/com/royalnet/qareports/config/SecurityConfig.java:46`
- Modify: `src/test/java/com/royalnet/qareports/security/SecurityRulesTest.java`

**Interfaces:**
- Consumes: nada.
- Produces: `GET /api/health` responde 200 sin autenticación, con cuerpo
  `{"success":true,"message":null,"data":"ok"}`. La tarea 6 lo usa como health check
  de Render y la tarea 7 lo usa para verificar el despliegue.

- [ ] **Step 1: Escribir el test que falla**

En `src/test/java/com/royalnet/qareports/security/SecurityRulesTest.java`, agregar el import del verbo GET junto a los que ya existen:

```java
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
```

y agregar este test dentro de la clase, siguiendo el estilo de `elLoginSigueSiendoPublico`:

```java
    @Test
    void elEndpointDeSaludEsPublico() throws Exception {
        mvc.perform(get("/api/health"))
           .andExpect(status().isOk());
    }
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `mvn -q test -Dtest=SecurityRulesTest`
Expected: FALLA — el endpoint no existe y `anyRequest().authenticated()` rechaza la petición anónima, así que llega un 4xx en vez de 200.

- [ ] **Step 3: Crear el controlador**

Crear `src/main/java/com/royalnet/qareports/controller/HealthController.java`:

```java
package com.royalnet.qareports.controller;

import com.royalnet.qareports.dto.Dtos.ApiResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Sonda pública: permite verificar un despliegue sin credenciales y le da al
 * cliente RunQA una llamada barata para despertar el servicio antes del login.
 */
@RestController
@RequestMapping("/api")
public class HealthController {

    @GetMapping("/health")
    public ResponseEntity<ApiResponse<String>> health() {
        return ResponseEntity.ok(ApiResponse.ok("ok"));
    }
}
```

- [ ] **Step 4: Abrir la ruta en la configuración de seguridad**

En `src/main/java/com/royalnet/qareports/config/SecurityConfig.java`, junto a la regla del login que ya existe, agregar:

```java
                .requestMatchers(HttpMethod.GET, "/api/health").permitAll()
```

inmediatamente después de la línea:

```java
                .requestMatchers(HttpMethod.POST, "/api/auth/login").permitAll()
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `mvn -q test -Dtest=SecurityRulesTest`
Expected: PASA.

- [ ] **Step 6: Correr la suite completa**

Run: `mvn test`
Expected: **31 tests, 0 failures**.

- [ ] **Step 7: Commit** *(solo si el usuario lo autorizó)*

```bash
git add src/main/java/com/royalnet/qareports/controller/HealthController.java src/main/java/com/royalnet/qareports/config/SecurityConfig.java src/test/java/com/royalnet/qareports/security/SecurityRulesTest.java
git commit -m "feat(health): endpoint público GET /api/health para sondear el despliegue"
```

---

### Task 5: Dockerfile e higiene del repositorio

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `.gitignore`

**Interfaces:**
- Consumes: el puerto configurable de la Task 2.
- Produces: una imagen que arranca con `java -jar app.jar` escuchando en `$PORT`.
  La tarea 6 la construye en Render.

**Advertencia:** el daemon de Docker no está disponible en esta máquina, así que **estos archivos no se pueden probar localmente**. Su verificación real ocurre en el log de build de la Task 6. Los steps de abajo verifican solo lo verificable acá.

- [ ] **Step 1: Crear el `.gitignore`**

El repositorio **no tiene `.gitignore`** y `target/` aparece como archivo sin trackear. Crear `.gitignore`:

```gitignore
target/
*.class

# Credenciales: nunca deben entrar al repositorio.
google-credentials.json
src/main/resources/google-credentials.json
.env

# IDE
.idea/
*.iml
.vscode/
```

- [ ] **Step 2: Crear el `.dockerignore`**

Crear `.dockerignore`, para que el contexto de build no arrastre el `target/` local ni el historial de git:

```dockerignore
target/
.git/
.gitignore
.superpowers/
migrations/
*.md
reporte_frontend.html
```

- [ ] **Step 3: Crear el `Dockerfile`**

Crear `Dockerfile`. El build usa el JDK de la imagen, así que no depende del `javac` 1.8 del sistema:

```dockerfile
# ---- build ----
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app

# Copiar primero el pom aprovecha la caché de capas: las dependencias solo se
# vuelven a bajar si cambia el pom, no en cada cambio de código.
COPY pom.xml .
RUN mvn -B dependency:go-offline

COPY src ./src
RUN mvn -B clean package -DskipTests

# ---- runtime ----
FROM eclipse-temurin:17-jre
WORKDIR /app

COPY --from=build /app/target/qa-reports-*.jar app.jar

# El plan gratuito de Render da 512 MB. Sin este tope la JVM dimensiona el heap
# contra la memoria del host y el contenedor muere por OOM.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70"

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

- [ ] **Step 4: Verificar que el `.gitignore` surte efecto**

Run: `git status --short`
Expected: `target/` ya no aparece; sí aparecen `Dockerfile`, `.dockerignore` y `.gitignore` como nuevos.

- [ ] **Step 5: Verificar que el jar se llama como espera el Dockerfile**

Run: `mvn -q package -DskipTests && ls target/*.jar`
Expected: aparece `target/qa-reports-1.0.0.jar`, que coincide con el patrón `qa-reports-*.jar` del `COPY`.

- [ ] **Step 6: Commit** *(solo si el usuario lo autorizó)*

```bash
git add Dockerfile .dockerignore .gitignore
git commit -m "chore(docker): imagen multi-stage para desplegar en Render y .gitignore del repo"
```

---

### Task 6: Crear la infraestructura y desplegar

**Files:** ninguno. Esta tarea es manual y la ejecuta una persona en dos paneles web.

**Interfaces:**
- Consumes: el puerto de la Task 2, los secretos de la Task 3, el health check de la Task 4 y el Dockerfile de la Task 5.
- Produces: **la URL pública del backend**, con forma `https://<nombre-del-servicio>.onrender.com`. La Task 7 la necesita.

**Requisito previo:** las tareas 1 a 5 tienen que estar **commiteadas y pusheadas** a `https://github.com/BynelsonDa/ReportRas_Backe.git`, porque Render construye desde GitHub. Aquí es donde el usuario tiene que autorizar los commits diferidos.

- [ ] **Step 1: Crear la base en Neon**

1. Entrar a <https://neon.com> y crear una cuenta (no pide tarjeta).
2. Crear un proyecto; elegir la región más cercana (`aws-us-east-1`).
3. En **Connection Details**, copiar la cadena, que tiene esta forma:
   `postgresql://USUARIO:PASSWORD@ep-algo-123.us-east-1.aws.neon.tech/neondb?sslmode=require`

**No ejecutar `migrations/2026-07-24-project-e-ingesta.sql` contra esta base.** Ese
script (`project_type DROP NOT NULL` más backfill) existe para bases que ya tenían
datos bajo el esquema anterior. La de Neon nace vacía: `ddl-auto: update` crea el
esquema correcto desde cero y `DataInitializer` siembra el admin en el primer
arranque. Correrlo sobre una base vacía falla, porque la tabla `qa_modules` todavía
no existe.

- [ ] **Step 2: Traducir la cadena de Neon a los tres valores que espera Spring**

Spring no acepta la URI de Neon tal cual: necesita una URL **JDBC** y el usuario y la contraseña por separado. De la cadena del step anterior salen:

| Variable | Valor |
|---|---|
| `SPRING_DATASOURCE_URL` | `jdbc:postgresql://ep-algo-123.us-east-1.aws.neon.tech/neondb?sslmode=require` |
| `DB_USERNAME` | `USUARIO` |
| `DB_PASSWORD` | `PASSWORD` |

Es decir: anteponer `jdbc:`, quitar el `USUARIO:PASSWORD@` del medio y **conservar el `?sslmode=require`**. Los nombres `DB_USERNAME` y `DB_PASSWORD` son los que `application.yml` ya lee.

- [ ] **Step 3: Generar los secretos**

Run: `openssl rand -base64 48`
Guardar la salida para `JWT_SECRET`. Repetir el comando (o elegir una contraseña propia) para `ADMIN_PASSWORD`. **No escribirlos en ningún archivo del repositorio.**

- [ ] **Step 4: Crear el servicio en Render**

1. Entrar a <https://render.com>, crear cuenta y conectar la de GitHub.
2. **New → Web Service**, elegir el repositorio `ReportRas_Backe`.
3. Configurar:
   - **Language / Runtime:** `Docker`
   - **Branch:** `main`
   - **Instance Type:** `Free`
   - **Health Check Path:** `/api/health`
4. En **Environment**, cargar las cinco variables: `SPRING_DATASOURCE_URL`, `DB_USERNAME`, `DB_PASSWORD`, `JWT_SECRET`, `ADMIN_PASSWORD`. **No definir `PORT`**: Render la inyecta sola.
5. Crear el servicio y seguir el log de build.

- [ ] **Step 5: Verificar el arranque**

En el log de Render, esperar:
- que el build de Docker termine sin error (esta es la verificación real del Dockerfile de la Task 5);
- `Started QaReportsApplication`;
- `Usuario admin creado — user: admin (contraseña tomada de ADMIN_PASSWORD)`;
- el warning de la Task 1 sobre Drive sin credenciales, que a esta altura es lo esperado.

Si el contenedor muere con `OOMKilled`, bajar `MaxRAMPercentage` a `60` en el `Dockerfile` y volver a desplegar.

- [ ] **Step 6: Verificar el endpoint público**

Run (reemplazando el dominio por el real): `curl -i https://<servicio>.onrender.com/api/health`
Expected: `HTTP/2 200` y cuerpo `{"success":true,"message":null,"data":"ok"}`.

- [ ] **Step 7: Verificar el login contra el dominio**

```bash
curl -s -X POST https://<servicio>.onrender.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}'
```

Expected: JSON con `success: true` y un `data.token` no vacío.

- [ ] **Step 8: Anotar la URL**

Dejar registrada la URL definitiva; la Task 7 la escribe en el código del cliente.

---

### Task 7: Apuntar el cliente Electron al backend desplegado

**Files:**
- Modify: `main/ipc.js:63`
- Modify: `renderer/renderer.js` (la pantalla `renderConfig`, alrededor de la línea 1495, y la pantalla `renderLogin`, líneas 656-675)

**Interfaces:**
- Consumes: la URL pública que produjo la Task 6.
- Produces: nada que otra tarea consuma.

**Working directory:** `~/Escritorio/Proyectos /TestQA/Qa_test_ejec/electron-app`

**Contexto:** las IPC `config:getServerUrl` y `config:setServerUrl` ya existen en `main/ipc.js:263-266` y están expuestas en `preload.js:73-74`, pero **ninguna pantalla las usa**. El repositorio no tiene tests de `renderer/`, así que los cambios de UI se verifican a mano y `npm test` queda como regresión.

- [ ] **Step 1: Cambiar la URL por defecto**

En `main/ipc.js`, reemplazar:

```js
  const DEFAULT_SERVER_URL = 'http://localhost:8080';
```

por (con el dominio real de la Task 6):

```js
  // Backend del piloto. Es solo el valor por defecto: Configuración lo sobreescribe.
  const DEFAULT_SERVER_URL = 'https://<servicio>.onrender.com';
```

- [ ] **Step 2: Agregar el campo "Servidor" en Configuración**

En `renderer/renderer.js`, dentro de la plantilla de `renderConfig`, insertar esta tarjeta **inmediatamente después** de la tarjeta del webhook de n8n (la que cierra tras `config-n8n-status`) y antes de la tarjeta "Repositorio":

```html
        <div class="card" style="margin-top:14px">
          <div class="config-label">Servidor de reportes</div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <input id="config-server" type="text" value="${escapeHtml(serverUrl)}" placeholder="https://mi-backend.onrender.com" style="flex:1;padding:10px;border:1px solid #dbe3ef;border-radius:8px;box-sizing:border-box">
            <button class="btn btn-primary btn-sm" id="config-server-save">Guardar</button>
          </div>
          <div class="config-hint">A dónde se envían las corridas. Aplica a toda la aplicación, no solo a este proyecto. Si lo dejas vacío se usa el valor por defecto.</div>
          <div id="config-server-status" class="config-hint" style="color:var(--green-dark)"></div>
        </div>
```

- [ ] **Step 3: Cargar el valor actual**

En la misma función, junto a la línea que ya obtiene la configuración del proyecto:

```js
  const cfg = await api.getProjectConfig(state.project);
```

agregar debajo:

```js
  const serverUrl = await api.getServerUrl();
```

Esto es necesario porque la plantilla del Step 2 interpola `serverUrl`, y sin esta línea quedaría indefinida.

- [ ] **Step 4: Enganchar el botón Guardar**

En la misma función, junto al handler `config-n8n-save` que ya existe, agregar:

```js
  document.getElementById('config-server-save').onclick = async () => {
    await api.setServerUrl(document.getElementById('config-server').value);
    const status = document.getElementById('config-server-status');
    status.textContent = 'Servidor guardado.';
    setTimeout(() => { status.textContent = ''; }, 2500);
  };
```

- [ ] **Step 5: Avisar del arranque en frío en el login**

En `renderer/renderer.js`, dentro de la plantilla de `renderLogin`, reemplazar:

```html
        <div id="login-error" style="display:none;color:#b91c1c;font-size:12px;margin-top:10px"></div>
```

por:

```html
        <div id="login-error" style="display:none;color:#b91c1c;font-size:12px;margin-top:10px"></div>
        <div style="color:#64748b;font-size:11px;margin-top:10px;text-align:center">
          El primer ingreso del día puede tardar hasta un minuto mientras el servidor despierta.
        </div>
```

- [ ] **Step 6: Correr la suite completa**

Run: `npm test`
Expected: **224/224**, sin cambios respecto de la línea base. Ninguno de estos archivos tiene tests propios; esto confirma que no se rompió nada.

- [ ] **Step 7: Verificación manual de la UI**

Run: `npm start`

Comprobar, en este orden:
1. La pantalla de login muestra el aviso del arranque en frío.
2. El login con `admin` y la `ADMIN_PASSWORD` de la Task 6 entra correctamente contra el dominio de Render.
3. En **Configuración**, la tarjeta "Servidor de reportes" muestra la URL de Render, y al guardar aparece "Servidor guardado.".

- [ ] **Step 8: Verificación de punta a punta**

1. Correr una prueba desde RunQA.
2. En la consola SQL de Neon, ejecutar `select * from test_runs order by id desc limit 5;` y confirmar que la corrida quedó registrada.
   **No existe `GET /api/runs`**: `IngestController` expone solo el POST, así que la verificación va contra la base.
3. Opcional, con el token del login: `curl -H "Authorization: Bearer <token>" https://<servicio>.onrender.com/api/modules/stats` y ver el coverage recalculado.
4. Esperar 15 minutos a que el servicio duerma, correr otra prueba y confirmar que la corrida queda encolada y se entrega sola cuando el servidor despierta.

- [ ] **Step 9: Commit** *(solo si el usuario lo autorizó)*

```bash
git add main/ipc.js renderer/renderer.js
git commit -m "feat(servidor): campo de servidor en Configuración y URL del piloto por defecto"
```
