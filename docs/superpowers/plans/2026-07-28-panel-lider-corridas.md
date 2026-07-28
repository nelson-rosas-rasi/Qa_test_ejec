# Panel del líder, rebanada 1: listado de corridas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el QA_LEAD entre a una URL pública con su usuario real y vea las corridas que reportan los analistas desde RunQA, pudiendo abrir cualquiera para revisar prueba por prueba con su error.

**Architecture:** Dos endpoints de lectura nuevos en Spring restringidos a `QA_LEAD`, y la maqueta React existente conectada a ellos por una capa HTTP que hoy no existe. Las dos mitades se construyen en paralelo contra el contrato JSON congelado en el spec: **las tareas 1-6 son del backend, las 7-11 del frontend**. Ninguna tarea toca RunQA (Electron).

**Orden y dependencias entre las dos mitades:** la Task 1 tiene que correr **antes** de que arranque el frontend — fija el formato de fechas sobre el que la Task 9 escribe el parseo. Después de eso, backend y frontend avanzan en paralelo hasta la Task 11 Step 7, donde se cruzan: el CORS del backend necesita la URL que produce el despliegue del panel.

**Tech Stack:** Spring Boot 3.2.5 / Java 17, Spring Data JPA, PostgreSQL (Neon), JUnit 5 + MockMvc + AssertJ; React 18 + Vite 5, sin librerías nuevas.

## Global Constraints

- El spec es [2026-07-28-panel-lider-corridas-design.md](../specs/2026-07-28-panel-lider-corridas-design.md). El contrato JSON de ahí es **la fuente de verdad**: si una tarea necesita cambiarlo, se para y se avisa, no se improvisa.
- **Tres directorios, todos con un espacio en `Proyectos /`** — van entre comillas siempre:
  - Backend: `~/Escritorio/Proyectos /SpringComuTestQa/ReportRas_Backe`
  - Frontend: `~/Escritorio/Proyectos /SpringComuTestQa/Frontend_RasiReport`
  - Specs y planes: `~/Escritorio/Proyectos /TestQA/Qa_test_ejec/docs/superpowers/`
- **`JAVA_HOME` es obligatorio para TODO comando Maven:**

  ```bash
  export JAVA_HOME=~/.jdks/jdk-21.0.12+8
  ```

  Sin esto, una compilación desde cero falla con `release version 17 not supported`: el JVM sobre el que arranca Maven (`/usr/lib/jvm/java-21-openjdk-amd64`) **es un JRE sin `javac`**, así que el plugin delega en `/usr/bin/javac`, que es Java 8. Un `mvn test` con `target/` ya compilado *parece* funcionar sin la variable porque no recompila: **eso es un falso verde**.
- **Líneas base:** backend `mvn test` = **31/31**. El frontend **no tiene infraestructura de tests y no se le agrega en esta rebanada**; se verifica a mano.
- **Sin dependencias nuevas** en `pom.xml` ni en `package.json`. Todo lo necesario ya está.
- Todo el copy de la UI y los mensajes de log **en español neutro**, como el resto de ambos repositorios.
- **Commits:** cada tarea termina en commit *solo si el usuario lo autorizó*. Pushear a GitHub **no** está autorizado por defecto.
- El backend en producción es `https://reportras-backe.onrender.com`. Credenciales del piloto: `admin` / la `ADMIN_PASSWORD` cargada en Render.

## Estructura de archivos

**Backend** (`src/main/java/com/royalnet/qareports/`):

| Archivo | Responsabilidad |
|---|---|
| `dto/Dtos.java` (modificar) | Agregar los seis DTOs de lectura de corridas, en su propia sección |
| `repository/TestRunRepository.java` (modificar) | Consultas paginadas con `@EntityGraph` |
| `repository/TestResultRepository.java` (modificar) | Resultados de una corrida, ordenados |
| `service/RunQueryService.java` (crear) | Traducción entidad → DTO y reglas de paginación |
| `controller/RunController.java` (crear) | Los dos endpoints HTTP y la autorización |

`RunQueryService` va aparte de `IngestService` a propósito: uno escribe y el otro lee, tienen ciclos de vida distintos y `IngestService` ya tiene 140 líneas.

**Frontend** (`src/`):

| Archivo | Responsabilidad |
|---|---|
| `api/client.js` (crear) | `fetch` con token, desenvoltura de `ApiResponse`, manejo del 401 |
| `api/runs.js` (crear) | Las dos llamadas concretas de corridas |
| `context/AppContext.jsx` (modificar) | Sesión real en vez de `login()` de mentira |
| `screens/LoginScreen.jsx` (modificar) | Login contra el backend + rechazo de roles que no son QA_LEAD |
| `screens/ResultsTab.jsx` (reescribir) | Listado real con paginación y detalle |
| `components/Sidebar.jsx` (modificar) | Navegación reducida y usuario real |

---

### Task 1: Confirmar cómo se serializan las fechas

**Files:**
- Create: `src/test/java/com/royalnet/qareports/dto/JacksonDatesTest.java`

**Interfaces:**
- Consumes: nada.
- Produces: la certeza de que `LocalDateTime` viaja como `"2026-07-28T10:15:02.120"`. **La Task 8 del frontend depende de este formato**; si el test falla, el contrato del spec está mal y hay que corregirlo antes de seguir.

**Contexto:** el spec asume que Spring Boot serializa `LocalDateTime` en ISO-8601 porque desactiva `WRITE_DATES_AS_TIMESTAMPS` por defecto. Está asumido, no verificado, y el frontend va a escribir el parseo de fechas sobre esa suposición. Verificarlo cuesta un test y evita retrabajo en los dos repos.

- [ ] **Step 1: Escribir el test**

Crear `src/test/java/com/royalnet/qareports/dto/JacksonDatesTest.java`:

```java
package com.royalnet.qareports.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.royalnet.qareports.TestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDateTime;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * El panel del líder parsea las fechas que devuelve la API. Este test fija el
 * formato: si algún día se agrega configuración de Jackson que lo cambie, falla
 * acá y no en el navegador.
 */
@SpringBootTest
@ActiveProfiles("test")
@Import(TestSupport.class)
class JacksonDatesTest {

    @Autowired private ObjectMapper mapper;

    @Test
    void localDateTimeViajaComoTextoIso8601() throws Exception {
        LocalDateTime momento = LocalDateTime.of(2026, 7, 28, 10, 15, 2, 120_000_000);

        String json = mapper.writeValueAsString(Map.of("recibida", momento));

        assertThat(json).isEqualTo("{\"recibida\":\"2026-07-28T10:15:02.12\"}");
    }
}
```

- [ ] **Step 2: Correr el test**

Run: `mvn -q test -Dtest=JacksonDatesTest`

Expected: **PASA**. Si falla, leé el valor real que reporta AssertJ:
- Si es un número (`1785...`) o un array (`[2026,7,28,...]`), el contrato del spec es incorrecto: **pará el plan y avisá**, porque el frontend no puede empezar.
- Si es ISO pero con otra cantidad de decimales, corregí el literal esperado del test y **anotá el formato exacto en el spec**. Jackson recorta ceros a la derecha en los nanosegundos: `.120` se emite como `.12`.

- [ ] **Step 3: Correr la suite completa**

Run: `mvn test`
Expected: **32 tests, 0 failures**.

- [ ] **Step 4: Commit** *(solo si el usuario lo autorizó)*

```bash
git add src/test/java/com/royalnet/qareports/dto/JacksonDatesTest.java
git commit -m "test(json): fijar el formato ISO-8601 de las fechas que consume el panel"
```

---

### Task 2: DTOs de lectura de corridas

**Files:**
- Modify: `src/main/java/com/royalnet/qareports/dto/Dtos.java` (agregar al final, antes de la sección `Generic`)

**Interfaces:**
- Consumes: nada.
- Produces: seis clases estáticas dentro de `Dtos`, que las tareas 3, 4 y 5 usan por nombre:
  - `RunProjectRef(Long id, String name, String repoUrl)`
  - `RunUserRef(String username, String fullName)`
  - `RunSummary` — los campos de una corrida sin resultados
  - `RunResultDto` — una prueba dentro de una corrida
  - `RunDetail` — `RunSummary` + `List<RunResultDto> results`
  - `RunPage` — `List<RunSummary> content`, `int page`, `int size`, `long totalElements`, `int totalPages`

**Contexto:** el repositorio agrupa todos los DTOs como clases estáticas dentro de `Dtos`, con `@Data @Builder @NoArgsConstructor @AllArgsConstructor`. Se sigue ese patrón. `RunDetail` **no** extiende `RunSummary`: Lombok `@Builder` con herencia obliga a `@SuperBuilder` y a tocar las clases de arriba; repetir seis campos es más barato que eso.

- [ ] **Step 1: Agregar los DTOs**

En `src/main/java/com/royalnet/qareports/dto/Dtos.java`, insertar antes del comentario `// ─── Generic ───`:

```java
    // ─── Lectura de corridas (panel del líder) ───────────────────────────────

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class RunProjectRef {
        private Long id;
        private String name;
        private String repoUrl;
    }

    /** Puede ser null: IngestService guarda la corrida aunque el usuario no exista. */
    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class RunUserRef {
        private String username;
        private String fullName;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class RunSummary {
        private Long id;
        private String runId;
        private RunProjectRef project;
        private RunUserRef user;
        private String mode;
        private LocalDateTime startedAt;
        private LocalDateTime finishedAt;
        private LocalDateTime receivedAt;
        private Long durationMs;
        private Integer total;
        private Integer passed;
        private Integer failed;
        private Integer skipped;
        private boolean discardedByQa;
    }

    /** module es null cuando el spec vive en la raíz del repo (sin módulo). */
    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class RunResultDto {
        private Long id;
        private String testId;
        private String name;
        private String specFile;
        private RunModuleRef module;
        private String status;
        private Long durationMs;
        private boolean flaky;
        private String error;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class RunModuleRef {
        private Long id;
        private String name;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class RunDetail {
        private Long id;
        private String runId;
        private RunProjectRef project;
        private RunUserRef user;
        private String mode;
        private LocalDateTime startedAt;
        private LocalDateTime finishedAt;
        private LocalDateTime receivedAt;
        private Long durationMs;
        private Integer total;
        private Integer passed;
        private Integer failed;
        private Integer skipped;
        private boolean discardedByQa;
        private List<RunResultDto> results;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class RunPage {
        private List<RunSummary> content;
        private int page;
        private int size;
        private long totalElements;
        private int totalPages;
    }
```

`LocalDateTime` y `List` ya están importados en el archivo.

- [ ] **Step 2: Verificar que compila**

Run: `mvn -q compile`
Expected: sin errores.

- [ ] **Step 3: Commit** *(solo si el usuario lo autorizó)*

```bash
git add src/main/java/com/royalnet/qareports/dto/Dtos.java
git commit -m "feat(dto): DTOs de lectura de corridas para el panel del líder"
```

---

### Task 3: Consultas paginadas en los repositorios

**Files:**
- Modify: `src/main/java/com/royalnet/qareports/repository/TestRunRepository.java`
- Modify: `src/main/java/com/royalnet/qareports/repository/TestResultRepository.java`
- Create: `src/test/java/com/royalnet/qareports/repository/TestRunRepositoryTest.java`

**Interfaces:**
- Consumes: nada.
- Produces, para la Task 4:
  - `Page<TestRun> findAllBy(Pageable pageable)`
  - `Page<TestRun> findByProjectId(Long projectId, Pageable pageable)`
  - `Optional<TestRun> findWithProjectAndUserById(Long id)`
  - `List<TestResult> findByRunOrderByIdAsc(TestRun run)`

**Contexto:** `TestRunRepository` hoy solo tiene `findByProjectAndRunId`. Se agregan métodos con `@EntityGraph(attributePaths = {"project", "user"})`, que trae proyecto y usuario en la misma consulta y evita un N+1 de 40 consultas por página de 20.

**Por qué `findAllBy` y no `findAll`:** `findAll(Pageable)` viene heredado de `JpaRepository` y **la anotación `@EntityGraph` no se aplica a métodos heredados**; hay que declarar uno propio. `findAllBy` es la convención de Spring Data para "todos, sin filtro".

**Por qué el `@EntityGraph` acá es seguro:** paginar con *fetch join* solo es problemático sobre colecciones (`@OneToMany`), donde Hibernate pagina en memoria y avisa con `HHH000104`. `project` y `user` son `@ManyToOne`, o sea to-one: el join no multiplica filas y la paginación se resuelve en SQL.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/test/java/com/royalnet/qareports/repository/TestRunRepositoryTest.java`:

```java
package com.royalnet.qareports.repository;

import com.royalnet.qareports.entity.Project;
import com.royalnet.qareports.entity.TestRun;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest
@ActiveProfiles("test")
class TestRunRepositoryTest {

    @Autowired private TestRunRepository runRepository;
    @Autowired private ProjectRepository projectRepository;

    private Project erp;
    private Project medical;

    @BeforeEach
    void sembrarDosProyectosConCorridas() {
        erp = projectRepository.save(Project.builder()
                .name("ERP").repoUrl("https://git/erp.git").active(true).build());
        medical = projectRepository.save(Project.builder()
                .name("Medical").repoUrl("https://git/medical.git").active(true).build());

        // receivedAt lo pone @CreationTimestamp, así que se fija a mano para poder
        // afirmar el orden: sin esto las tres filas comparten el mismo instante.
        guardar(erp, "run-vieja", LocalDateTime.of(2026, 7, 20, 8, 0));
        guardar(erp, "run-nueva", LocalDateTime.of(2026, 7, 28, 8, 0));
        guardar(medical, "run-medical", LocalDateTime.of(2026, 7, 24, 8, 0));
    }

    private void guardar(Project project, String runId, LocalDateTime recibida) {
        TestRun run = runRepository.save(TestRun.builder()
                .project(project).runId(runId).total(1).passed(1).failed(0).skipped(0)
                .build());
        run.setReceivedAt(recibida);
        runRepository.saveAndFlush(run);
    }

    @Test
    void devuelveLasCorridasMasRecientesPrimero() {
        Page<TestRun> page = runRepository.findAllBy(
                PageRequest.of(0, 10, Sort.by(Sort.Direction.DESC, "receivedAt")));

        assertThat(page.getContent()).extracting(TestRun::getRunId)
                .containsExactly("run-nueva", "run-medical", "run-vieja");
        assertThat(page.getTotalElements()).isEqualTo(3);
    }

    @Test
    void elFiltroPorProyectoExcluyeLasCorridasDeOtros() {
        Page<TestRun> page = runRepository.findByProjectId(medical.getId(),
                PageRequest.of(0, 10, Sort.by(Sort.Direction.DESC, "receivedAt")));

        assertThat(page.getContent()).extracting(TestRun::getRunId)
                .containsExactly("run-medical");
    }

    @Test
    void laPaginacionRecortaYReportaElTotalCompleto() {
        Page<TestRun> page = runRepository.findAllBy(
                PageRequest.of(0, 2, Sort.by(Sort.Direction.DESC, "receivedAt")));

        assertThat(page.getContent()).hasSize(2);
        assertThat(page.getTotalElements()).isEqualTo(3);
        assertThat(page.getTotalPages()).isEqualTo(2);
    }
}
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `mvn -q test -Dtest=TestRunRepositoryTest`
Expected: **FALLA** al arrancar el contexto, porque `findAllBy` y `findByProjectId` todavía no existen en la interfaz (`QueryCreationException` / `No property 'findAllBy' found`).

- [ ] **Step 3: Agregar las consultas a `TestRunRepository`**

Reemplazar `src/main/java/com/royalnet/qareports/repository/TestRunRepository.java` por:

```java
package com.royalnet.qareports.repository;

import com.royalnet.qareports.entity.Project;
import com.royalnet.qareports.entity.TestRun;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface TestRunRepository extends JpaRepository<TestRun, Long> {

    Optional<TestRun> findByProjectAndRunId(Project project, String runId);

    // El @EntityGraph trae proyecto y usuario en la misma consulta: sin él, una
    // página de 20 corridas dispara 40 consultas extra. Es seguro paginar con él
    // porque ambas son @ManyToOne (to-one): el join no multiplica filas.
    // findAll(Pageable) viene heredado y NO respeta @EntityGraph; por eso findAllBy.
    @EntityGraph(attributePaths = {"project", "user"})
    Page<TestRun> findAllBy(Pageable pageable);

    @EntityGraph(attributePaths = {"project", "user"})
    Page<TestRun> findByProjectId(Long projectId, Pageable pageable);

    @EntityGraph(attributePaths = {"project", "user"})
    Optional<TestRun> findWithProjectAndUserById(Long id);
}
```

- [ ] **Step 4: Agregar la consulta de resultados**

En `src/main/java/com/royalnet/qareports/repository/TestResultRepository.java`, agregar el import `com.royalnet.qareports.entity.TestRun`, el import `org.springframework.data.jpa.repository.EntityGraph`, y el método:

```java
    /** Los resultados de una corrida, en el orden en que se ingirieron. */
    @EntityGraph(attributePaths = {"module"})
    List<TestResult> findByRunOrderByIdAsc(TestRun run);
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `mvn -q test -Dtest=TestRunRepositoryTest`
Expected: **PASA**, 3 tests.

- [ ] **Step 6: Correr la suite completa**

Run: `mvn test`
Expected: **35 tests, 0 failures**.

- [ ] **Step 7: Commit** *(solo si el usuario lo autorizó)*

```bash
git add src/main/java/com/royalnet/qareports/repository/ src/test/java/com/royalnet/qareports/repository/
git commit -m "feat(repo): consultas paginadas de corridas con fetch de proyecto y usuario"
```

---

### Task 4: El servicio de lectura

**Files:**
- Create: `src/main/java/com/royalnet/qareports/service/RunQueryService.java`

**Interfaces:**
- Consumes: los DTOs de la Task 2 y las consultas de la Task 3.
- Produces, para la Task 5:
  - `RunPage listRuns(Long projectId, int page, int size)`
  - `RunDetail getRun(Long id)` — lanza `ResourceNotFoundException` si no existe
  - `public static final int MAX_PAGE_SIZE = 100`

**Contexto:** `ResourceNotFoundException` ya existe en `exception/` y `GlobalExceptionHandler` la traduce a 404, así que el servicio solo tiene que lanzarla.

- [ ] **Step 1: Crear el servicio**

Crear `src/main/java/com/royalnet/qareports/service/RunQueryService.java`:

```java
package com.royalnet.qareports.service;

import com.royalnet.qareports.dto.Dtos.*;
import com.royalnet.qareports.entity.TestResult;
import com.royalnet.qareports.entity.TestRun;
import com.royalnet.qareports.exception.ResourceNotFoundException;
import com.royalnet.qareports.repository.TestResultRepository;
import com.royalnet.qareports.repository.TestRunRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Lectura de corridas para el panel del líder. Separado de IngestService a
 * propósito: uno escribe y el otro lee, y no comparten nada más que las tablas.
 */
@Service
@RequiredArgsConstructor
public class RunQueryService {

    /** Sin tope, un size=100000 obliga a materializar la tabla entera: los 512 MB de Render no lo toleran. */
    public static final int MAX_PAGE_SIZE = 100;
    public static final int DEFAULT_PAGE_SIZE = 20;

    private final TestRunRepository runRepository;
    private final TestResultRepository resultRepository;

    @Transactional(readOnly = true)
    public RunPage listRuns(Long projectId, int page, int size) {
        // Se ordena por receivedAt y no por finishedAt: la cola offline de RunQA
        // puede entregar hoy una corrida de ayer, y ordenar por cuándo se ejecutó
        // la enterraría en medio de la lista.
        PageRequest request = PageRequest.of(
                Math.max(page, 0),
                Math.min(Math.max(size, 1), MAX_PAGE_SIZE),
                Sort.by(Sort.Direction.DESC, "receivedAt"));

        Page<TestRun> resultado = projectId != null
                ? runRepository.findByProjectId(projectId, request)
                : runRepository.findAllBy(request);

        return RunPage.builder()
                .content(resultado.getContent().stream().map(this::toSummary).toList())
                .page(resultado.getNumber())
                .size(resultado.getSize())
                .totalElements(resultado.getTotalElements())
                .totalPages(resultado.getTotalPages())
                .build();
    }

    @Transactional(readOnly = true)
    public RunDetail getRun(Long id) {
        TestRun run = runRepository.findWithProjectAndUserById(id)
                .orElseThrow(() -> new ResourceNotFoundException("No existe la corrida " + id));

        List<RunResultDto> results = resultRepository.findByRunOrderByIdAsc(run)
                .stream().map(this::toResultDto).toList();

        return RunDetail.builder()
                .id(run.getId())
                .runId(run.getRunId())
                .project(toProjectRef(run))
                .user(toUserRef(run))
                .mode(run.getMode())
                .startedAt(run.getStartedAt())
                .finishedAt(run.getFinishedAt())
                .receivedAt(run.getReceivedAt())
                .durationMs(run.getDurationMs())
                .total(run.getTotal())
                .passed(run.getPassed())
                .failed(run.getFailed())
                .skipped(run.getSkipped())
                .discardedByQa(run.isDiscardedByQa())
                .results(results)
                .build();
    }

    private RunSummary toSummary(TestRun run) {
        return RunSummary.builder()
                .id(run.getId())
                .runId(run.getRunId())
                .project(toProjectRef(run))
                .user(toUserRef(run))
                .mode(run.getMode())
                .startedAt(run.getStartedAt())
                .finishedAt(run.getFinishedAt())
                .receivedAt(run.getReceivedAt())
                .durationMs(run.getDurationMs())
                .total(run.getTotal())
                .passed(run.getPassed())
                .failed(run.getFailed())
                .skipped(run.getSkipped())
                .discardedByQa(run.isDiscardedByQa())
                .build();
    }

    private RunProjectRef toProjectRef(TestRun run) {
        return RunProjectRef.builder()
                .id(run.getProject().getId())
                .name(run.getProject().getName())
                .repoUrl(run.getProject().getRepoUrl())
                .build();
    }

    /** Null cuando la corrida quedó huérfana: IngestService la guarda igual. */
    private RunUserRef toUserRef(TestRun run) {
        if (run.getUser() == null) return null;
        return RunUserRef.builder()
                .username(run.getUser().getUsername())
                .fullName(run.getUser().getFullName())
                .build();
    }

    private RunResultDto toResultDto(TestResult result) {
        RunModuleRef module = result.getModule() == null ? null
                : RunModuleRef.builder()
                        .id(result.getModule().getId())
                        .name(result.getModule().getName())
                        .build();

        return RunResultDto.builder()
                .id(result.getId())
                .testId(result.getTestId())
                .name(result.getName())
                .specFile(result.getSpecFile())
                .module(module)
                .status(result.getStatus())
                .durationMs(result.getDurationMs())
                .flaky(result.isFlaky())
                .error(result.getError())
                .build();
    }
}
```

- [ ] **Step 2: Verificar que compila**

Run: `mvn -q compile`
Expected: sin errores. El servicio se prueba por HTTP en la Task 5, que es donde importa el contrato.

- [ ] **Step 3: Commit** *(solo si el usuario lo autorizó)*

```bash
git add src/main/java/com/royalnet/qareports/service/RunQueryService.java
git commit -m "feat(runs): servicio de lectura de corridas con paginación acotada"
```

---

### Task 5: Los dos endpoints

**Files:**
- Create: `src/main/java/com/royalnet/qareports/controller/RunController.java`
- Create: `src/test/java/com/royalnet/qareports/controller/RunControllerTest.java`

**Interfaces:**
- Consumes: `RunQueryService` de la Task 4.
- Produces: `GET /api/runs` y `GET /api/runs/{id}` según el contrato del spec. **La Task 8 del frontend consume exactamente esta forma.**

**Contexto:** `@EnableMethodSecurity` ya está activo en `SecurityConfig`, así que `@PreAuthorize` funciona sin configuración extra. No hay que tocar `SecurityConfig`: la regla `anyRequest().authenticated()` ya cubre estas rutas, y `@PreAuthorize` agrega el filtro por rol.

**Cuidado con el nombre del rol:** `hasRole('QA_LEAD')` espera la autoridad `ROLE_QA_LEAD`. Es la convención que ya usa `POST /api/auth/register`, así que funciona igual acá.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/test/java/com/royalnet/qareports/controller/RunControllerTest.java`:

```java
package com.royalnet.qareports.controller;

import com.royalnet.qareports.TestSupport;
import com.royalnet.qareports.entity.*;
import com.royalnet.qareports.enums.ModuleStatus;
import com.royalnet.qareports.repository.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDateTime;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(TestSupport.class)
class RunControllerTest {

    @Autowired private MockMvc mvc;
    @Autowired private ProjectRepository projectRepository;
    @Autowired private TestRunRepository runRepository;
    @Autowired private TestResultRepository resultRepository;
    @Autowired private QaModuleRepository moduleRepository;

    private Long idCorridaConResultados;

    @BeforeEach
    void sembrar() {
        resultRepository.deleteAll();
        runRepository.deleteAll();

        Project erp = projectRepository.save(Project.builder()
                .name("ERP").repoUrl("https://git/erp-" + System.nanoTime() + ".git").active(true).build());

        TestRun vieja = guardar(erp, "run-vieja", LocalDateTime.of(2026, 7, 20, 8, 0));
        TestRun nueva = guardar(erp, "run-nueva", LocalDateTime.of(2026, 7, 28, 8, 0));

        QaModule modulo = moduleRepository.save(QaModule.builder()
                .project(erp).name("atenciones").status(ModuleStatus.IN_PROGRESS).coverage(0).build());

        resultRepository.save(TestResult.builder()
                .run(nueva).module(modulo)
                .testId("test/atenciones/login.spec.ts:12").name("ingresa bien")
                .specFile("test/atenciones/login.spec.ts").status("passed").durationMs(2100L)
                .build());
        // Sin módulo: spec en la raíz del repo.
        resultRepository.save(TestResult.builder()
                .run(nueva).module(null)
                .testId("suelto.spec.ts:3").name("prueba suelta")
                .specFile("suelto.spec.ts").status("failed").durationMs(900L)
                .error("TimeoutError: locator.click")
                .build());

        idCorridaConResultados = nueva.getId();
    }

    private TestRun guardar(Project project, String runId, LocalDateTime recibida) {
        TestRun run = runRepository.save(TestRun.builder()
                .project(project).runId(runId).mode("conjunto")
                .total(2).passed(1).failed(1).skipped(0).durationMs(3000L)
                .build());
        run.setReceivedAt(recibida);
        return runRepository.saveAndFlush(run);
    }

    @Test
    @WithMockUser(username = "lead", roles = {"QA_LEAD"})
    void elListadoDevuelveLasMasRecientesPrimeroYRespetaElContrato() throws Exception {
        mvc.perform(get("/api/runs"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.success").value(true))
           .andExpect(jsonPath("$.data.content[0].runId").value("run-nueva"))
           .andExpect(jsonPath("$.data.content[1].runId").value("run-vieja"))
           .andExpect(jsonPath("$.data.content[0].project.name").value("ERP"))
           .andExpect(jsonPath("$.data.content[0].total").value(2))
           .andExpect(jsonPath("$.data.page").value(0))
           .andExpect(jsonPath("$.data.totalElements").value(2));
    }

    @Test
    @WithMockUser(username = "lead", roles = {"QA_LEAD"})
    void elListadoNoTraeLosResultadosIndividuales() throws Exception {
        mvc.perform(get("/api/runs"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.data.content[0].results").doesNotExist());
    }

    @Test
    @WithMockUser(username = "lead", roles = {"QA_LEAD"})
    void elSizeSeRecortaAlTope() throws Exception {
        mvc.perform(get("/api/runs").param("size", "5000"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.data.size").value(100));
    }

    @Test
    @WithMockUser(username = "lead", roles = {"QA_LEAD"})
    void elDetalleTraeLosResultadosYAceptaModuloNulo() throws Exception {
        mvc.perform(get("/api/runs/" + idCorridaConResultados))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.data.runId").value("run-nueva"))
           .andExpect(jsonPath("$.data.results.length()").value(2))
           .andExpect(jsonPath("$.data.results[0].module.name").value("atenciones"))
           .andExpect(jsonPath("$.data.results[1].module").doesNotExist())
           .andExpect(jsonPath("$.data.results[1].error").value("TimeoutError: locator.click"));
    }

    @Test
    @WithMockUser(username = "lead", roles = {"QA_LEAD"})
    void unaCorridaInexistenteDevuelve404() throws Exception {
        mvc.perform(get("/api/runs/999999"))
           .andExpect(status().isNotFound());
    }

    @Test
    @WithMockUser(username = "ana", roles = {"QA_ANALYST"})
    void unAnalistaNoPuedeLeerLasCorridas() throws Exception {
        mvc.perform(get("/api/runs")).andExpect(status().isForbidden());
        mvc.perform(get("/api/runs/1")).andExpect(status().isForbidden());
    }

    @Test
    void anonimoQuedaRechazado() throws Exception {
        mvc.perform(get("/api/runs")).andExpect(status().is4xxClientError());
    }
}
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `mvn -q test -Dtest=RunControllerTest`
Expected: **FALLA** — el controlador no existe, así que `GET /api/runs` cae en `anyRequest().authenticated()` y devuelve 404 en vez de 200.

- [ ] **Step 3: Crear el controlador**

Crear `src/main/java/com/royalnet/qareports/controller/RunController.java`:

```java
package com.royalnet.qareports.controller;

import com.royalnet.qareports.dto.Dtos.ApiResponse;
import com.royalnet.qareports.dto.Dtos.RunDetail;
import com.royalnet.qareports.dto.Dtos.RunPage;
import com.royalnet.qareports.service.RunQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/**
 * Lectura de corridas para el panel del líder. Solo QA_LEAD: los analistas
 * conservan permiso únicamente de ingesta.
 */
@RestController
@RequestMapping("/api/runs")
@RequiredArgsConstructor
@PreAuthorize("hasRole('QA_LEAD')")
public class RunController {

    private final RunQueryService runQueryService;

    // GET /api/runs?projectId=1&page=0&size=20
    @GetMapping
    public ResponseEntity<ApiResponse<RunPage>> listRuns(
            @RequestParam(required = false) Long projectId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {

        return ResponseEntity.ok(ApiResponse.ok(runQueryService.listRuns(projectId, page, size)));
    }

    // GET /api/runs/{id}
    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<RunDetail>> getRun(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(runQueryService.getRun(id)));
    }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `mvn -q test -Dtest=RunControllerTest`
Expected: **PASA**, 7 tests.

Si `elListadoNoTraeLosResultadosIndividuales` falla porque `results` aparece como `null` en vez de ausente, es correcto igual: `RunSummary` no tiene ese campo. Revisá que el test esté pegándole a `content[0]` y no al detalle.

- [ ] **Step 5: Correr la suite completa**

Run: `mvn test`
Expected: **42 tests, 0 failures**.

- [ ] **Step 6: Verificar contra la base real**

Las cinco variables son las mismas que están cargadas en Render (`SPRING_DATASOURCE_URL`, `DB_USERNAME`, `DB_PASSWORD`, `JWT_SECRET`, `ADMIN_PASSWORD`); se copian de ahí. Apuntan a la base de Neon del piloto, así que esto lee **datos reales**, no un H2 de prueba.

```bash
export JAVA_HOME=~/.jdks/jdk-21.0.12+8
export SPRING_DATASOURCE_URL='jdbc:postgresql://ep-aged-cherry-ax2u9nyr.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require'
export DB_USERNAME='neondb_owner'
export DB_PASSWORD='<la de Neon>'
export JWT_SECRET='<la de Render>'
export ADMIN_PASSWORD='<la de Render>'
mvn spring-boot:run
```

En otra terminal:

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"'"$ADMIN_PASSWORD"'"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
curl -s -H "Authorization: Bearer $TOKEN" 'http://localhost:8080/api/runs?size=5'
```

Expected: un `RunPage` con la forma exacta del contrato. **Guardá esta respuesta**: es el ejemplo real contra el que el frontend verifica su parseo.

- [ ] **Step 7: Commit** *(solo si el usuario lo autorizó)*

```bash
git add src/main/java/com/royalnet/qareports/controller/RunController.java src/test/java/com/royalnet/qareports/controller/RunControllerTest.java
git commit -m "feat(runs): GET /api/runs y /api/runs/{id} para el panel del líder"
```

---

### Task 6: Desplegar el backend actualizado y abrir el CORS

**Files:** ninguno. Manual, en el panel de Render.

**Interfaces:**
- Consumes: las tareas 1-5 commiteadas y **pusheadas** a `https://github.com/BynelsonDa/ReportRas_Backe` (Render construye desde GitHub).
- Produces: los dos endpoints vivos en `https://reportras-backe.onrender.com` y el origen del panel autorizado por CORS. Las tareas 8-11 lo necesitan.

- [ ] **Step 1: Pushear**

Requiere autorización explícita del usuario. `git push origin main`.

- [ ] **Step 2: Esperar el deploy**

En el log de Render: build sin error, `Started QaReportsApplication`, `Your service is live`.

**No confundir el recambio con una caída:** durante el deploy el free tier queda sin instancia y las peticiones devuelven **404 con `x-render-routing: no-server`**, alternando con 200 mientras drena. Es normal y dura lo que tarde el arranque (~2 min).

- [ ] **Step 3: Verificar el endpoint contra el dominio**

```bash
TOKEN=$(curl -s -X POST https://reportras-backe.onrender.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
curl -s -H "Authorization: Bearer $TOKEN" 'https://reportras-backe.onrender.com/api/runs?size=5'
```

Expected: `{"success":true,...,"data":{"content":[...],"page":0,...}}`.

- [ ] **Step 4: Agregar el origen del panel al CORS**

En Render, servicio `reportras-backe` → **Environment**, agregar:

```
CORS_ALLOWED_ORIGINS=https://<nombre-del-panel>.onrender.com
```

**En mayúsculas y con guiones bajos.** La propiedad que lee `SecurityConfig` es `cors.allowed-origins`; Spring la resuelve por *relaxed binding*. Escrita con puntos en Render **no la toma**.

Este paso se completa después de la Task 11, cuando exista la URL del panel. Para desarrollo local, agregar también `http://localhost:5173` (el puerto de `vite dev`), separado por coma.

---

### Task 7: Capa HTTP del frontend

**Files:**
- Create: `src/api/client.js`
- Create: `src/api/runs.js`
- Create: `.env.example`

**Working directory:** `~/Escritorio/Proyectos /SpringComuTestQa/Frontend_RasiReport`

**Interfaces:**
- Consumes: el contrato del spec.
- Produces, para las tareas 8-10:
  - `apiFetch(path, options)` — devuelve el `data` ya desenvuelto, lanza `ApiError`
  - `class ApiError extends Error` con `.status` y `.message`
  - `getToken()`, `setSession(session)`, `getSession()`, `clearSession()`
  - `login(username, password)` → `{ token, username, fullName, role }`
  - `listRuns({ page, size, projectId })` → `RunPage`
  - `getRun(id)` → `RunDetail`

**Contexto:** el proyecto **no tiene ninguna capa HTTP**: ni `fetch`, ni `axios`, ni una referencia a `/api/`. Todo sale de `src/data/seed.js`. Esto es lo primero que hay que construir.

- [ ] **Step 1: Crear `.env.example`**

```
# URL del backend. Vite congela las VITE_* en tiempo de BUILD, no las lee en
# runtime: cambiar esto exige volver a construir, no alcanza con reiniciar.
VITE_API_URL=https://reportras-backe.onrender.com
```

Crear además un `.env.local` propio (ya ignorado por el `.gitignore` de Vite) con `VITE_API_URL=http://localhost:8080` para desarrollo.

- [ ] **Step 2: Crear `src/api/client.js`**

```js
const BASE_URL = import.meta.env.VITE_API_URL || '';
const STORAGE_KEY = 'qa-panel-session';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function getSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Un localStorage corrupto no puede dejar la app inservible.
    return null;
  }
}

export const getToken = () => getSession()?.token || null;
export const setSession = (session) => localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
export const clearSession = () => localStorage.removeItem(STORAGE_KEY);

/** Se dispara ante un 401: el token venció y hay que volver al login. */
const sessionExpired = new EventTarget();
export const onSessionExpired = (handler) => {
  sessionExpired.addEventListener('expired', handler);
  return () => sessionExpired.removeEventListener('expired', handler);
};

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  } catch {
    // Falla de red, CORS o backend dormido que nunca respondió.
    throw new ApiError('No se pudo conectar con el servidor. Puede estar despertando: probá de nuevo en un minuto.', 0);
  }

  if (response.status === 401) {
    clearSession();
    sessionExpired.dispatchEvent(new Event('expired'));
    throw new ApiError('Tu sesión venció. Volvé a iniciar sesión.', 401);
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok || (body && body.success === false)) {
    throw new ApiError(body?.message || `Error del servidor (${response.status}).`, response.status);
  }

  return body?.data ?? null;
}

export function login(username, password) {
  return apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}
```

- [ ] **Step 3: Crear `src/api/runs.js`**

```js
import { apiFetch } from './client.js';

export function listRuns({ page = 0, size = 20, projectId = null } = {}) {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  if (projectId != null) params.set('projectId', String(projectId));
  return apiFetch(`/api/runs?${params}`);
}

export function getRun(id) {
  return apiFetch(`/api/runs/${id}`);
}
```

- [ ] **Step 4: Verificar que el proyecto sigue compilando**

Run: `npm run build`
Expected: build sin errores. Los módulos nuevos todavía no los importa nadie, así que el bundle no cambia de tamaño de forma apreciable.

- [ ] **Step 5: Commit** *(solo si el usuario lo autorizó)*

```bash
git add src/api/ .env.example
git commit -m "feat(api): capa HTTP contra el backend qa-reports"
```

---

### Task 8: Login real

**Files:**
- Modify: `src/context/AppContext.jsx`
- Modify: `src/screens/LoginScreen.jsx:12-23` (la función `submit` y el estado)

**Interfaces:**
- Consumes: `login`, `setSession`, `getSession`, `clearSession`, `onSessionExpired`, `ApiError` de la Task 7.
- Produces, para las tareas 9-10: el contexto expone `session` (`{ token, username, fullName, role }` o `null`) y `logout()`.

**Contexto:** hoy `AppContext.login()` no valida nada: pone `stage` en `splash`, espera 2200 ms y pasa a `app`. `LoginScreen` llama a `submit()`, que espera 600 ms y entra con cualquier credencial. El campo se llama "Correo corporativo" pero **el backend autentica por `username`, no por email** — hay que cambiar la etiqueta o el login siempre va a fallar.

- [ ] **Step 1: Reescribir `AppContext.jsx`**

```jsx
import { createContext, useContext, useEffect, useState } from 'react';
import { SEED } from '../data/seed.js';
import { getSession, clearSession, onSessionExpired } from '../api/client.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }) {
  const [session, setSession] = useState(() => getSession());
  const [stage, setStage] = useState(() => (getSession() ? 'app' : 'login'));
  const [tab, setTab] = useState('results');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  // El 401 puede saltar en cualquier llamada: la sesión venció mientras el panel
  // estaba abierto. Volver al login desde acá evita repetir el manejo en cada pantalla.
  useEffect(() => onSessionExpired(() => {
    setSession(null);
    setStage('login');
  }), []);

  function onLoggedIn(nuevaSesion) {
    setSession(nuevaSesion);
    setStage('splash');
    setTimeout(() => setStage('app'), 2200);
  }

  function logout() {
    clearSession();
    setSession(null);
    setStage('login');
    setTab('results');
  }

  const value = {
    stage, setStage, onLoggedIn, logout, session,
    tab, setTab, filter, setFilter, search, setSearch,
    // El seed queda solo para las pestañas todavía no conectadas.
    data: SEED,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
```

**Nota:** desaparecen `project`, `setProject` y `proj`. La Task 10 saca del `Sidebar` el selector de workspaces que los usaba; si alguna otra pantalla los consume, esa pantalla se oculta en la Task 10.

- [ ] **Step 2: Conectar `LoginScreen.jsx`**

Reemplazar los imports y el cuerpo de la función `submit` (líneas 12-23) por:

```jsx
export default function LoginScreen() {
  const { onLoggedIn } = useApp();
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      const sesion = await login(username.trim(), pw);
      // Cortar acá y no en cada pantalla: un analista que entra bien vería todo
      // fallando con 403 y parecería un error del sistema.
      if (sesion.role !== 'QA_LEAD') {
        setError('Este panel es solo para el líder de QA. Tu usuario no tiene ese permiso.');
        clearSession();
        return;
      }
      setSession(sesion);
      onLoggedIn(sesion);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
```

Agregar arriba del archivo:

```jsx
import { login, setSession, clearSession } from '../api/client.js';
```

- [ ] **Step 3: Ajustar el formulario**

Tres cambios en el JSX:

1. La etiqueta `Correo corporativo` pasa a `Usuario`, y su `input` usa `value={username} onChange={e => setUsername(e.target.value)}`. **El backend autentica por `username`**: dejar "correo" garantiza que nadie pueda entrar.
2. Insertar el error justo antes del botón de ingresar:

```jsx
          {error && (
            <div style={{ fontSize: 12, color: '#B3261E', background: '#FDECEA', border: '1px solid #F5C6C2', borderRadius: 4, padding: '9px 11px' }}>
              {error}
            </div>
          )}
```

3. Eliminar el botón "Google Workspace · RASI SOLUCIONES" (líneas 68-76) y el bloque "2FA activo" (líneas 60-63). Ninguna de las dos cosas existe: el botón de Google llamaba a `submit` y entraba sin credenciales.

- [ ] **Step 4: Verificación manual**

Run: `npm run dev` con el backend corriendo en `http://localhost:8080` y `.env.local` apuntando ahí.

Comprobar:
1. Usuario o contraseña incorrectos → aparece el mensaje del backend, no entra.
2. `admin` con la contraseña correcta → entra y muestra el splash.
3. Un usuario `QA_ANALYST` → rechazado con el mensaje de permisos.
4. Recargar la página con sesión → entra directo sin volver a pedir credenciales.

- [ ] **Step 5: Commit** *(solo si el usuario lo autorizó)*

```bash
git add src/context/AppContext.jsx src/screens/LoginScreen.jsx
git commit -m "feat(login): autenticación real contra el backend, solo QA_LEAD"
```

---

### Task 9: Listado de corridas

**Files:**
- Modify: `src/screens/ResultsTab.jsx` (reescritura completa)

**Interfaces:**
- Consumes: `listRuns` de la Task 7.
- Produces, para la Task 10: nada. Es una pantalla hoja.

**Contexto:** `ResultsTab` hoy inventa filas a partir de `proj.files` (grabaciones del seed) y fabrica números de ejecución con `RUN-${2841 - index}`. Se reescribe entera. Los estilos existentes se conservan: mismo contenedor, mismos colores de `theme.js`, misma grilla.

- [ ] **Step 1: Reescribir la pantalla**

```jsx
import { useEffect, useState } from 'react';
import { listRuns } from '../api/runs.js';
import { C } from '../theme.js';
import RunDetailPanel from './RunDetailPanel.jsx';

const TAM_PAGINA = 20;

const celdas = '150px 1.4fr 1fr 130px 150px 110px';

function formatearFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatearDuracion(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function ResultsTab() {
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [abierta, setAbierta] = useState(null);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError('');
    listRuns({ page: pagina, size: TAM_PAGINA })
      .then(r => { if (vigente) setDatos(r); })
      .catch(e => { if (vigente) setError(e.message); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [pagina]);

  if (cargando) {
    return (
      <div style={{ padding: '48px 28px', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
        Cargando corridas…
        <div style={{ fontSize: 11.5, marginTop: 8 }}>
          Si es la primera consulta del día puede demorar hasta dos minutos mientras el servidor despierta.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '48px 28px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: '#B3261E' }}>{error}</div>
        <button onClick={() => setPagina(p => p)} style={{ marginTop: 14, padding: '8px 14px', border: `1px solid ${C.borderStrong}`, background: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 12.5 }}>
          Reintentar
        </button>
      </div>
    );
  }

  const corridas = datos?.content || [];

  return (
    <div style={{ padding: '24px 28px 32px' }}>
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 14, fontWeight: 650 }}>Últimas ejecuciones recibidas</div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 3 }}>
            {datos?.totalElements ?? 0} corridas reportadas desde RunQA
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: celdas, padding: '10px 18px', background: C.bg, color: C.textMuted, fontSize: 10.5, fontWeight: 700, letterSpacing: .4, textTransform: 'uppercase' }}>
          <span>Ejecución</span><span>Proyecto</span><span>Analista</span><span>Duración</span><span>Recibida</span><span>Resultado</span>
        </div>

        {corridas.length === 0 && (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: C.textMuted, fontSize: 12.5 }}>
            Todavía no llegó ninguna corrida.
          </div>
        )}

        {corridas.map((run, index) => {
          const fallidas = run.failed || 0;
          return (
            <div key={run.id} onClick={() => setAbierta(run.id)}
              style={{ display: 'grid', gridTemplateColumns: celdas, padding: '13px 18px', alignItems: 'center', borderTop: index ? `1px solid ${C.border}` : 'none', fontSize: 12, cursor: 'pointer' }}>
              <span style={{ fontFamily: 'ui-monospace, monospace', color: C.textMuted }}>{run.runId}</span>
              <span style={{ fontWeight: 600 }}>{run.project?.name || '—'}</span>
              <span style={{ color: C.textMuted }}>{run.user?.fullName || '—'}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatearDuracion(run.durationMs)}</span>
              <span style={{ color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>{formatearFecha(run.receivedAt)}</span>
              <span style={{ justifySelf: 'start', padding: '4px 9px', borderRadius: 12, background: fallidas === 0 ? C.doneSoft : C.repairSoft, color: fallidas === 0 ? '#0F5A3A' : '#8A2A1F', fontSize: 11, fontWeight: 650 }}>
                {run.passed || 0}/{run.total || 0}
              </span>
            </div>
          );
        })}

        {datos && datos.totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '12px 18px', borderTop: `1px solid ${C.border}`, fontSize: 12 }}>
            <span style={{ color: C.textMuted }}>Página {datos.page + 1} de {datos.totalPages}</span>
            <button disabled={datos.page === 0} onClick={() => setPagina(p => p - 1)}
              style={{ padding: '6px 11px', border: `1px solid ${C.borderStrong}`, background: '#fff', borderRadius: 4, cursor: datos.page === 0 ? 'default' : 'pointer', opacity: datos.page === 0 ? .45 : 1, fontSize: 12 }}>
              Anterior
            </button>
            <button disabled={datos.page + 1 >= datos.totalPages} onClick={() => setPagina(p => p + 1)}
              style={{ padding: '6px 11px', border: `1px solid ${C.borderStrong}`, background: '#fff', borderRadius: 4, cursor: datos.page + 1 >= datos.totalPages ? 'default' : 'pointer', opacity: datos.page + 1 >= datos.totalPages ? .45 : 1, fontSize: 12 }}>
              Siguiente
            </button>
          </div>
        )}
      </div>

      {abierta && <RunDetailPanel runId={abierta} onClose={() => setAbierta(null)} />}
    </div>
  );
}
```

- [ ] **Step 2: No verificar todavía**

La primera línea importa `RunDetailPanel`, que se crea recién en la Task 10. **Hasta entonces `npm run dev` y `npm run build` fallan** con `Failed to resolve import`. Es esperado: no intentes arreglarlo ni crear un archivo vacío para tapar el error.

Las tareas 9 y 10 forman una unidad — se verifican y se commitean juntas, al final de la Task 10. Si necesitás ver la tabla antes, creá el archivo de la Task 10 primero y volvé acá.

---

### Task 10: Detalle de una corrida

**Files:**
- Create: `src/screens/RunDetailPanel.jsx`

**Interfaces:**
- Consumes: `getRun` de la Task 7. Recibe `{ runId, onClose }` de la Task 9.
- Produces: nada.

- [ ] **Step 1: Crear el panel**

```jsx
import { useEffect, useState } from 'react';
import { getRun } from '../api/runs.js';
import { C } from '../theme.js';

const ETIQUETA = { passed: 'Exitosa', failed: 'Fallida', skipped: 'Omitida' };

export default function RunDetailPanel({ runId, onClose }) {
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let vigente = true;
    getRun(runId)
      .then(r => { if (vigente) setRun(r); })
      .catch(e => { if (vigente) setError(e.message); });
    return () => { vigente = false; };
  }, [runId]);

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', justifyContent: 'flex-end', zIndex: 50 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 'min(760px, 92vw)', background: '#fff', height: '100%', overflowY: 'auto', boxShadow: '-8px 0 24px rgba(0,0,0,.12)' }}>

        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 650 }}>{run?.runId || 'Cargando…'}</div>
            <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 3 }}>
              {run ? `${run.project?.name || '—'} · ${run.user?.fullName || 'Sin analista'}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 20, color: C.textMuted, lineHeight: 1 }}>×</button>
        </div>

        {error && <div style={{ padding: 22, fontSize: 13, color: '#B3261E' }}>{error}</div>}
        {!run && !error && <div style={{ padding: 22, fontSize: 13, color: C.textMuted }}>Cargando el detalle…</div>}

        {run && (
          <>
            <div style={{ display: 'flex', gap: 22, padding: '14px 22px', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
              <span><b>{run.total ?? 0}</b> pruebas</span>
              <span style={{ color: '#0F5A3A' }}><b>{run.passed ?? 0}</b> exitosas</span>
              <span style={{ color: '#8A2A1F' }}><b>{run.failed ?? 0}</b> fallidas</span>
              <span style={{ color: C.textMuted }}><b>{run.skipped ?? 0}</b> omitidas</span>
            </div>

            <div style={{ padding: '8px 0' }}>
              {run.results.map(t => (
                <div key={t.id} style={{ padding: '12px 22px', borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span style={{ padding: '3px 8px', borderRadius: 10, fontSize: 10.5, fontWeight: 650,
                      background: t.status === 'passed' ? C.doneSoft : t.status === 'failed' ? C.repairSoft : C.bg,
                      color: t.status === 'passed' ? '#0F5A3A' : t.status === 'failed' ? '#8A2A1F' : C.textMuted }}>
                      {ETIQUETA[t.status] || t.status}
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0 }}>{t.name || t.testId}</span>
                    <span style={{ fontSize: 11.5, color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                      {t.durationMs != null ? `${Math.round(t.durationMs / 100) / 10}s` : '—'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>
                    {t.module?.name ? `${t.module.name} · ` : 'Sin módulo · '}{t.specFile || t.testId}
                  </div>
                  {t.error && (
                    <pre style={{ margin: '9px 0 0', padding: '10px 12px', background: '#FDF2F1', border: '1px solid #F5C6C2', borderRadius: 4, fontSize: 11, color: '#8A2A1F', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220, overflow: 'auto' }}>
                      {t.error}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificación manual**

Run: `npm run dev`

Comprobar: al hacer clic en una fila se abre el panel lateral; las pruebas fallidas muestran su error en el bloque rojo; una prueba de un spec en la raíz muestra "Sin módulo"; el clic en el fondo o en la × lo cierra.

- [ ] **Step 3: Commit de las tareas 9 y 10** *(solo si el usuario lo autorizó)*

```bash
git add src/screens/ResultsTab.jsx src/screens/RunDetailPanel.jsx
git commit -m "feat(corridas): listado paginado y detalle de una corrida"
```

---

### Task 11: Ocultar lo que todavía no es real y publicar

**Files:**
- Modify: `src/components/Sidebar.jsx:9-20` (navegación y workspaces) y `:83-92` (usuario)
- Modify: `src/screens/MainApp.jsx:18-21`

**Interfaces:**
- Consumes: `session` del contexto (Task 8).
- Produces: la URL pública del panel, que la Task 6 Step 4 necesita para el CORS.

**Contexto:** el `Sidebar` arma el selector de workspaces desde `data.erp` / `data.med` del seed y calcula módulos terminados de datos inventados; el pie muestra "Laura Méndez" hardcodeada. La navegación ofrece cuatro pestañas de las que solo "Resultados" tiene datos reales.

**Por qué se saca el selector de workspaces:** filtrar por proyecto necesita la lista de proyectos, y **no existe `GET /api/projects`**. Agregarlo excede esta rebanada. El proyecto de cada corrida se ve en su columna, y el selector vuelve en la rebanada 2, cuando el endpoint de módulos lo haga necesario. Es una desviación deliberada del diseño visual original: se anota acá para que no parezca un olvido.

- [ ] **Step 1: Reducir la navegación**

En `src/components/Sidebar.jsx`, reemplazar las líneas 9-20 por:

```jsx
  const { tab, setTab, logout, session } = useApp();
  // Solo Resultados tiene datos reales. El resto se habilita en las rebanadas
  // siguientes: un panel que mezcla datos reales con el seed es peor que uno chico.
  const navItems = [
    { id: 'results', label: 'Resultados', icon: ICONS.check },
  ];
  const iniciales = (session?.fullName || session?.username || '?')
    .split(' ').slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('');
```

- [ ] **Step 2: Eliminar el bloque de workspaces**

Borrar el `<div style={{ padding: '16px 14px 8px' }}>…</div>` completo (líneas 33-56 del original), que renderiza "Workspaces". Usa `projects`, que ya no existe.

- [ ] **Step 3: Mostrar el usuario real**

Reemplazar el pie (líneas 83-92 del original) por:

```jsx
      <div style={{ padding: '14px 16px', borderTop: '1px solid rgba(255,255,255,.1)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#185FA5', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600 }}>{iniciales}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{session?.fullName || session?.username || ''}</div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.52)' }}>Líder de QA</div>
        </div>
        <button onClick={logout} title="Cerrar sesión" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 4, display: 'grid', placeItems: 'center' }}>
          <Ic d={ICONS.logout} size={14} stroke="rgba(255,255,255,.58)" />
        </button>
      </div>
```

Eliminar también el bloque "Monitor en línea" (líneas 71-82): dice "Última recepción hace 2 min" con un número inventado.

- [ ] **Step 4: Podar `MainApp.jsx`**

Reemplazar las líneas 18-21 por:

```jsx
          {tab === 'results' && <ResultsTab />}
```

y borrar los imports de `ModulesTab`, `FilesTab` y `ReportsTab`. Los archivos **no se borran**: se reconectan en las rebanadas siguientes.

- [ ] **Step 5: Verificar el build**

Run: `npm run build`
Expected: build limpio, sin warnings de imports sin usar ni de variables indefinidas. Si aparece un error por `proj` o `project`, quedó una pantalla del seed enganchada: revisá que `MainApp` ya no la renderice.

- [ ] **Step 6: Publicar en Render**

1. **New → Static Site**, repositorio del frontend.
2. **Build Command:** `npm install && npm run build`
3. **Publish Directory:** `dist`
4. **Environment:** `VITE_API_URL=https://reportras-backe.onrender.com`
5. Crear y esperar el build.

- [ ] **Step 7: Cerrar el CORS**

Volver a la Task 6 Step 4 y cargar `CORS_ALLOWED_ORIGINS` en el backend con la URL que acaba de dar Render. Esperar el redeploy del backend (~2 min).

**Sin este paso el panel carga pero toda llamada falla**, y en la consola del navegador aparece un error de CORS, no un 401 ni un 500.

- [ ] **Step 8: Verificación de punta a punta**

1. Abrir la URL del panel.
2. Entrar como `admin`.
3. Ver el listado de corridas reales.
4. Abrir una corrida y ver sus pruebas con errores.
5. Correr una prueba nueva desde RunQA y confirmar que aparece al recargar.
6. Entrar con un usuario `QA_ANALYST` y confirmar el rechazo.

- [ ] **Step 9: Commit** *(solo si el usuario lo autorizó)*

```bash
git add src/components/Sidebar.jsx src/screens/MainApp.jsx
git commit -m "feat(panel): navegación reducida a lo que tiene datos reales"
```
