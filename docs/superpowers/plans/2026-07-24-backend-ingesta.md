# Backend: identidad e ingesta de corridas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el backend `qa-reports` reciba y persista las corridas de pruebas de todos los escritorios RunQA, atribuyéndolas a su proyecto (repo), su QA y su módulo (carpeta).

**Architecture:** Se añade una tabla `Project` que identifica cada repo por `repoUrl` (clave de correlación entre escritorios) y de la que cuelgan los módulos. Dos entidades nuevas, `TestRun` y `TestResult`, guardan las corridas y sus resultados. Dos endpoints nuevos (`POST /api/sync/modules` y `POST /api/runs`) hacen la ingesta, con idempotencia por `runId` y atribución a módulo por la primera carpeta del path del spec.

**Tech Stack:** Spring Boot 3.2.5, Java 17, Maven, Spring Data JPA, Spring Security + JWT (jjwt), PostgreSQL (producción) / H2 (tests), Lombok, JUnit 5 + `spring-boot-starter-test`.

## Global Constraints

- Repositorio: `/home/nrosas@corp.rasi.com.co/Escritorio/Proyectos /SpringComuTestQa/ReportRas_Backe`. Todos los comandos se ejecutan desde ahí.
- Suite: `mvn test`. **Estado base: 0 tests — `src/test` no existe.** La Task 1 crea la infraestructura; a partir de ahí ninguna tarea puede dejar la suite en rojo.
- **Este repositorio está limpio** (4 commits, sin WIP), así que **sí se commitea por tarea**, a diferencia del repo de RunQA.
- **`GoogleDriveConfig` crea el bean `Drive` leyendo `classpath:google-credentials.json` al arrancar, y ese archivo no existe en el repo.** Cualquier `@SpringBootTest` debe reemplazar ese bean con `@MockBean` o el contexto no levanta. La Task 1 deja esto resuelto para las demás.
- Convenciones existentes que hay que respetar: todas las respuestas se envuelven en `Dtos.ApiResponse<T>` (`ok`/`error`); los errores se lanzan como `ResourceNotFoundException` (404) o `BadRequestException` (400) y los traduce `GlobalExceptionHandler`; los DTOs viven como clases estáticas dentro de `Dtos.java`; las entidades usan Lombok (`@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder`).
- El usuario autenticado se obtiene del JWT: el principal es un `UserDetails` de Spring, así que la entidad se resuelve con `userRepository.findByUsername(auth.getName())`. **Nunca tomar el usuario del cuerpo de la petición.**
- `ddl-auto: update` crea columnas nuevas pero **no relaja restricciones ni migra datos**: cuando el plan lo requiera, se incluye el SQL explícito.

## File Structure

Nuevos:
- `src/test/resources/application-test.yml` — perfil de test con H2.
- `src/test/java/com/royalnet/qareports/TestSupport.java` — configuración común de tests (mock del bean `Drive`).
- `src/test/java/com/royalnet/qareports/ContextLoadsTest.java`
- `src/main/java/com/royalnet/qareports/ingest/TestIdParser.java` — lógica pura de atribución.
- `src/test/java/com/royalnet/qareports/ingest/TestIdParserTest.java`
- `src/main/java/com/royalnet/qareports/entity/Project.java`
- `src/main/java/com/royalnet/qareports/entity/TestRun.java`
- `src/main/java/com/royalnet/qareports/entity/TestResult.java`
- `src/main/java/com/royalnet/qareports/repository/ProjectRepository.java`
- `src/main/java/com/royalnet/qareports/repository/TestRunRepository.java`
- `src/main/java/com/royalnet/qareports/repository/TestResultRepository.java`
- `src/main/java/com/royalnet/qareports/service/IngestService.java`
- `src/main/java/com/royalnet/qareports/controller/IngestController.java`
- Tests de integración por endpoint.

Modificados:
- `pom.xml` — dependencia H2 (scope test).
- `entity/QaModule.java` — FK a `Project`; `projectType` pasa a nullable (legado).
- `service/impl/QaModuleServiceImpl.java` — quitar los `getProjectType().name()` que darían NPE.
- `dto/Dtos.java` — DTOs de ingesta.
- `config/SecurityConfig.java` — cerrar `register`, reglas de los endpoints nuevos.

> **Nota de alcance:** esta plan deja `QaModule.projectType` como **columna legado nullable**; `Project` pasa a ser el dueño real. Migrar los endpoints de módulos existentes (`getModules`, `getStats`, `ModuleRequest/Response`) para que dejen de usar el enum es un **plan de seguimiento**: no hace falta para la ingesta y multiplicaría el tamaño de éste.

---

### Task 1: Infraestructura de tests (H2 + contexto que arranca)

Sin esto no se puede verificar nada más: hoy `mvn test` no ejecuta ni un test, y un `@SpringBootTest` fallaría por el bean de Drive.

**Files:**
- Modify: `pom.xml`
- Create: `src/test/resources/application-test.yml`
- Create: `src/test/java/com/royalnet/qareports/TestSupport.java`
- Create: `src/test/java/com/royalnet/qareports/ContextLoadsTest.java`

**Interfaces:**
- Produces: `TestSupport` — clase con `@TestConfiguration` que provee un `Drive` mock; las tareas siguientes la importan en sus tests de integración con `@Import(TestSupport.class)` y `@ActiveProfiles("test")`.

- [ ] **Step 1: Añadir H2 al `pom.xml`**

En `<dependencies>`, junto a las de test (después del bloque `spring-security-test`):

```xml
        <dependency>
            <groupId>com.h2database</groupId>
            <artifactId>h2</artifactId>
            <scope>test</scope>
        </dependency>
```

- [ ] **Step 2: Crear el perfil de test**

`src/test/resources/application-test.yml`:

```yaml
spring:
  datasource:
    url: jdbc:h2:mem:qa_reports_test;DB_CLOSE_DELAY=-1;MODE=PostgreSQL
    driver-class-name: org.h2.Driver
    username: sa
    password: ""
  jpa:
    hibernate:
      ddl-auto: create-drop
    properties:
      hibernate:
        dialect: org.hibernate.dialect.H2Dialect

app:
  jwt:
    secret: test-secret-key-qa-reports-royalnet-muy-larga-para-hmac-sha
    expiration-ms: 86400000

google:
  drive:
    credentials-path: classpath:application-test.yml
    root-folder-id: test-folder

cors:
  allowed-origins: http://localhost:3000
```

> `credentials-path` apunta a un archivo que sí existe solo para que el `@Value` resuelva; el bean `Drive` igualmente se reemplaza por un mock en el paso siguiente.

- [ ] **Step 3: Crear el soporte común de tests**

`src/test/java/com/royalnet/qareports/TestSupport.java`:

```java
package com.royalnet.qareports;

import com.google.api.services.drive.Drive;
import org.mockito.Mockito;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/**
 * GoogleDriveConfig construye el bean Drive leyendo un archivo de credenciales
 * que no existe en el repositorio: sin este reemplazo el contexto no arranca.
 */
@TestConfiguration
public class TestSupport {

    @Bean
    @Primary
    public Drive googleDriveService() {
        return Mockito.mock(Drive.class);
    }
}
```

- [ ] **Step 4: Test de humo del contexto**

`src/test/java/com/royalnet/qareports/ContextLoadsTest.java`:

```java
package com.royalnet.qareports;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
@Import(TestSupport.class)
class ContextLoadsTest {

    @Autowired
    private ApplicationContext context;

    @Test
    void elContextoArranca() {
        assertThat(context).isNotNull();
    }
}
```

- [ ] **Step 5: Ejecutar**

Run: `mvn test`
Expected: PASS — 1 test. Si falla por el bean `Drive`, revisar que `@Import(TestSupport.class)` y `@Primary` estén puestos.

- [ ] **Step 6: Commit**

```bash
git add pom.xml src/test
git commit -m "test: infraestructura de tests con H2 y mock de Drive"
```

---

### Task 2: `TestIdParser` — atribución de un test a su módulo (TDD)

Lógica pura, sin Spring: dado el id de un test de RunQA, sacar el archivo y la carpeta (= módulo). Un spec en la raíz no tiene carpeta.

**Files:**
- Create: `src/main/java/com/royalnet/qareports/ingest/TestIdParser.java`
- Test: `src/test/java/com/royalnet/qareports/ingest/TestIdParserTest.java`

**Interfaces:**
- Produces: `TestIdParser.specFileOf(String testId)` → `String`; `TestIdParser.moduleFolderOf(String testId)` → `String` o `null` si el spec está en la raíz. Las usa `IngestService` (Task 6).

- [ ] **Step 1: Escribir el test que falla**

`src/test/java/com/royalnet/qareports/ingest/TestIdParserTest.java`:

```java
package com.royalnet.qareports.ingest;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class TestIdParserTest {

    @Test
    void extraeElArchivoQuitandoLaLinea() {
        assertThat(TestIdParser.specFileOf("atenciones/cobros.spec.ts:12"))
                .isEqualTo("atenciones/cobros.spec.ts");
    }

    @Test
    void laPrimeraCarpetaEsElModulo() {
        assertThat(TestIdParser.moduleFolderOf("atenciones/cobros.spec.ts:12"))
                .isEqualTo("atenciones");
    }

    @Test
    void unSpecEnLaRaizNoTieneModulo() {
        assertThat(TestIdParser.moduleFolderOf("grabacion-sin-refinar.spec.ts:3")).isNull();
    }

    @Test
    void conVariasCarpetasCuentaLaPrimera() {
        assertThat(TestIdParser.moduleFolderOf("atenciones/sub/x.spec.ts:1")).isEqualTo("atenciones");
    }

    @Test
    void toleraUnIdSinNumeroDeLinea() {
        assertThat(TestIdParser.specFileOf("atenciones/cobros.spec.ts")).isEqualTo("atenciones/cobros.spec.ts");
        assertThat(TestIdParser.moduleFolderOf("atenciones/cobros.spec.ts")).isEqualTo("atenciones");
    }

    @Test
    void toleraNuloOVacio() {
        assertThat(TestIdParser.specFileOf(null)).isNull();
        assertThat(TestIdParser.moduleFolderOf(null)).isNull();
        assertThat(TestIdParser.moduleFolderOf("")).isNull();
    }
}
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `mvn test -Dtest=TestIdParserTest`
Expected: FAIL — no compila, `TestIdParser` no existe.

- [ ] **Step 3: Implementar**

`src/main/java/com/royalnet/qareports/ingest/TestIdParser.java`:

```java
package com.royalnet.qareports.ingest;

/**
 * RunQA identifica cada prueba como "<ruta del spec>:<línea>", con la ruta
 * relativa al testDir de Playwright y siempre con "/". La primera carpeta de esa
 * ruta es el área funcional (el módulo); un spec en la raíz es una grabación sin
 * refinar y no pertenece a ningún módulo.
 */
public final class TestIdParser {

    private TestIdParser() {}

    public static String specFileOf(String testId) {
        if (testId == null || testId.isBlank()) return null;
        int colon = testId.lastIndexOf(':');
        return colon > 0 ? testId.substring(0, colon) : testId;
    }

    public static String moduleFolderOf(String testId) {
        String file = specFileOf(testId);
        if (file == null) return null;
        int slash = file.indexOf('/');
        return slash > 0 ? file.substring(0, slash) : null;
    }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `mvn test -Dtest=TestIdParserTest`
Expected: PASS — 6 tests.

- [ ] **Step 5: Suite completa y commit**

Run: `mvn test` → PASS (1 + 6 = 7).

```bash
git add src/main/java/com/royalnet/qareports/ingest src/test/java/com/royalnet/qareports/ingest
git commit -m "feat(ingest): atribución de un test a su módulo por la carpeta del spec"
```

---

### Task 3: Entidad `Project` y su relación con `QaModule`

`Project` identifica cada repo por `repoUrl` (lo único estable entre escritorios). `QaModule` pasa a colgar de él, y `projectType` queda como columna legado **nullable**.

**Files:**
- Create: `src/main/java/com/royalnet/qareports/entity/Project.java`
- Create: `src/main/java/com/royalnet/qareports/repository/ProjectRepository.java`
- Modify: `src/main/java/com/royalnet/qareports/entity/QaModule.java`
- Modify: `src/main/java/com/royalnet/qareports/service/impl/QaModuleServiceImpl.java` (líneas 70 y 135)
- Test: `src/test/java/com/royalnet/qareports/repository/ProjectRepositoryTest.java`

**Interfaces:**
- Produces: `Project` (`id`, `name`, `repoUrl` único, `active`, `createdAt`); `ProjectRepository.findByRepoUrl(String)` → `Optional<Project>`; `QaModule.getProject()/setProject(Project)`. Los usan las Tasks 5 y 6.

- [ ] **Step 1: Crear la entidad `Project`**

`src/main/java/com/royalnet/qareports/entity/Project.java`:

```java
package com.royalnet.qareports.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * Un repositorio de pruebas ("vista" en RunQA). Se correlaciona entre escritorios
 * por repoUrl: el id local de RunQA es un slug del nombre que escribió el QA y no
 * sirve como clave global.
 */
@Entity
@Table(name = "projects")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Project {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 150)
    private String name;

    @Column(name = "repo_url", nullable = false, unique = true, length = 500)
    private String repoUrl;

    @Column(nullable = false)
    @Builder.Default
    private boolean active = true;

    @CreationTimestamp
    private LocalDateTime createdAt;
}
```

- [ ] **Step 2: Crear el repositorio**

`src/main/java/com/royalnet/qareports/repository/ProjectRepository.java`:

```java
package com.royalnet.qareports.repository;

import com.royalnet.qareports.entity.Project;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface ProjectRepository extends JpaRepository<Project, Long> {
    Optional<Project> findByRepoUrl(String repoUrl);
}
```

- [ ] **Step 3: Relacionar `QaModule` con `Project`**

En `src/main/java/com/royalnet/qareports/entity/QaModule.java`, reemplazar el bloque actual de `projectType`:

```java
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ProjectType projectType;
```

por:

```java
    /** Legado: lo sustituye `project`. Queda nullable hasta que se migren los endpoints de módulos. */
    @Enumerated(EnumType.STRING)
    @Column(name = "project_type")
    private ProjectType projectType;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "project_id")
    private Project project;
```

Y añadir la restricción única de nombre por proyecto en la anotación `@Table` de la clase, que pasa de `@Table(name = "qa_modules")` a:

```java
@Table(name = "qa_modules",
       uniqueConstraints = @UniqueConstraint(name = "uk_module_project_name", columnNames = {"project_id", "name"}))
```

- [ ] **Step 4: Quitar los `getProjectType().name()` que darían NPE**

Los módulos que creará la ingesta no tendrán `projectType`, y hoy hay dos sitios que lo desreferencian directamente.

En `service/impl/QaModuleServiceImpl.java` línea 70, reemplazar:

```java
            String folderName = request.getProjectType().name() + "_" + request.getName();
```

por:

```java
            String folderName = driveFolderPrefix(module) + "_" + request.getName();
```

En la línea 135, reemplazar:

```java
                folderId = driveService.createFolder(module.getProjectType().name() + "_" + module.getName(), null);
```

por:

```java
                folderId = driveService.createFolder(driveFolderPrefix(module) + "_" + module.getName(), null);
```

Y añadir este helper en la sección `// ─── Helpers ───` (junto a `findModuleOrThrow`):

```java
    /** Prefijo de la carpeta en Drive: el proyecto si existe, si no el enum legado. */
    private String driveFolderPrefix(QaModule module) {
        if (module.getProject() != null) return module.getProject().getName();
        if (module.getProjectType() != null) return module.getProjectType().name();
        return "SIN_PROYECTO";
    }
```

- [ ] **Step 5: Test del repositorio**

`src/test/java/com/royalnet/qareports/repository/ProjectRepositoryTest.java`:

```java
package com.royalnet.qareports.repository;

import com.royalnet.qareports.entity.Project;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@DataJpaTest
@ActiveProfiles("test")
class ProjectRepositoryTest {

    @Autowired
    private ProjectRepository projects;

    @Test
    void guardaYEncuentraPorRepoUrl() {
        projects.save(Project.builder().name("ERP").repoUrl("https://git/erp.git").build());
        assertThat(projects.findByRepoUrl("https://git/erp.git")).isPresent();
        assertThat(projects.findByRepoUrl("https://git/otro.git")).isEmpty();
    }

    @Test
    void laRepoUrlEsUnica() {
        projects.save(Project.builder().name("ERP").repoUrl("https://git/erp.git").build());
        assertThatThrownBy(() -> {
            projects.saveAndFlush(Project.builder().name("Otro").repoUrl("https://git/erp.git").build());
        }).isInstanceOf(DataIntegrityViolationException.class);
    }
}
```

> `@DataJpaTest` no carga `GoogleDriveConfig`, así que aquí no hace falta `TestSupport`.

- [ ] **Step 6: Correr**

Run: `mvn test`
Expected: PASS — 7 + 2 = 9.

- [ ] **Step 7: SQL de migración para la base existente**

`ddl-auto: update` **no** relaja el `NOT NULL` que ya tiene `project_type` en PostgreSQL. Ejecutar una vez contra `qa_reports_db` antes de desplegar:

```sql
ALTER TABLE qa_modules ALTER COLUMN project_type DROP NOT NULL;
INSERT INTO projects (name, repo_url, active, created_at)
  VALUES ('ERP', 'PENDIENTE-ERP', true, now()),
         ('MEDICAL', 'PENDIENTE-MEDICAL', true, now())
  ON CONFLICT (repo_url) DO NOTHING;
UPDATE qa_modules m SET project_id = p.id
  FROM projects p WHERE p.name = m.project_type::text AND m.project_id IS NULL;
```

Las `repoUrl` `PENDIENTE-*` se corrigen con la URL real de cada repo la primera vez que se sincronice desde RunQA (o a mano). Si la base es de desarrollo y se puede recrear, basta con borrarla y dejar que Hibernate la genere.

- [ ] **Step 8: Commit**

```bash
git add src/main/java/com/royalnet/qareports/entity src/main/java/com/royalnet/qareports/repository/ProjectRepository.java src/main/java/com/royalnet/qareports/service/impl/QaModuleServiceImpl.java src/test/java/com/royalnet/qareports/repository
git commit -m "feat(project): tabla Project correlacionada por repoUrl y módulos colgando de ella"
```

---

### Task 4: Entidades `TestRun` y `TestResult`

**Files:**
- Create: `src/main/java/com/royalnet/qareports/entity/TestRun.java`
- Create: `src/main/java/com/royalnet/qareports/entity/TestResult.java`
- Create: `src/main/java/com/royalnet/qareports/repository/TestRunRepository.java`
- Create: `src/main/java/com/royalnet/qareports/repository/TestResultRepository.java`
- Test: `src/test/java/com/royalnet/qareports/repository/TestRunRepositoryTest.java`

**Interfaces:**
- Consumes: `Project` (Task 3), `User` (existente).
- Produces: `TestRun`, `TestResult`, `TestRunRepository.findByProjectAndRunId(Project, String)` → `Optional<TestRun>`, `TestResultRepository`. Los usa `IngestService` (Task 6).

- [ ] **Step 1: Crear `TestRun`**

`src/main/java/com/royalnet/qareports/entity/TestRun.java`:

```java
package com.royalnet.qareports.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/** Una ejecución de pruebas reportada por un escritorio RunQA. */
@Entity
@Table(name = "test_runs",
       uniqueConstraints = @UniqueConstraint(name = "uk_run_project_runid", columnNames = {"project_id", "run_id"}))
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class TestRun {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Id que genera RunQA. Único por proyecto: da idempotencia ante reenvíos. */
    @Column(name = "run_id", nullable = false, length = 100)
    private String runId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "project_id", nullable = false)
    private Project project;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private User user;

    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;

    /** Reloj del servidor: los escritorios pueden ir desfasados. */
    @CreationTimestamp
    private LocalDateTime receivedAt;

    @Column(length = 20)
    private String mode;

    private Integer total;
    private Integer passed;
    private Integer failed;
    private Integer skipped;
    private Long durationMs;

    /** El QA eligió "Descartar" en su equipo; la corrida se guarda igual. */
    @Column(name = "discarded_by_qa", nullable = false)
    @Builder.Default
    private boolean discardedByQa = false;
}
```

- [ ] **Step 2: Crear `TestResult`**

`src/main/java/com/royalnet/qareports/entity/TestResult.java`:

```java
package com.royalnet.qareports.entity;

import jakarta.persistence.*;
import lombok.*;

/** Resultado de una prueba dentro de una corrida. */
@Entity
@Table(name = "test_results")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class TestResult {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "run_id", nullable = false)
    private TestRun run;

    /** Null = el spec está en la raíz: grabación sin refinar, sin módulo. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "module_id")
    private QaModule module;

    @Column(name = "test_id", nullable = false, length = 500)
    private String testId;

    @Column(name = "spec_file", length = 400)
    private String specFile;

    @Column(length = 500)
    private String name;

    @Column(length = 20)
    private String status;

    private Long durationMs;

    @Column(columnDefinition = "text")
    private String error;

    @Column(nullable = false)
    @Builder.Default
    private boolean flaky = false;
}
```

- [ ] **Step 3: Crear los repositorios**

`src/main/java/com/royalnet/qareports/repository/TestRunRepository.java`:

```java
package com.royalnet.qareports.repository;

import com.royalnet.qareports.entity.Project;
import com.royalnet.qareports.entity.TestRun;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface TestRunRepository extends JpaRepository<TestRun, Long> {
    Optional<TestRun> findByProjectAndRunId(Project project, String runId);
}
```

`src/main/java/com/royalnet/qareports/repository/TestResultRepository.java`:

```java
package com.royalnet.qareports.repository;

import com.royalnet.qareports.entity.QaModule;
import com.royalnet.qareports.entity.TestResult;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface TestResultRepository extends JpaRepository<TestResult, Long> {
    List<TestResult> findByModule(QaModule module);
}
```

- [ ] **Step 4: Test del repositorio**

`src/test/java/com/royalnet/qareports/repository/TestRunRepositoryTest.java`:

```java
package com.royalnet.qareports.repository;

import com.royalnet.qareports.entity.Project;
import com.royalnet.qareports.entity.TestRun;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@DataJpaTest
@ActiveProfiles("test")
class TestRunRepositoryTest {

    @Autowired private ProjectRepository projects;
    @Autowired private TestRunRepository runs;

    private Project unProyecto() {
        return projects.save(Project.builder().name("ERP").repoUrl("https://git/erp.git").build());
    }

    @Test
    void encuentraLaCorridaPorProyectoYRunId() {
        Project p = unProyecto();
        runs.save(TestRun.builder().project(p).runId("run-1").build());
        assertThat(runs.findByProjectAndRunId(p, "run-1")).isPresent();
        assertThat(runs.findByProjectAndRunId(p, "run-9")).isEmpty();
    }

    @Test
    void elMismoRunIdNoSePuedeRepetirEnElMismoProyecto() {
        Project p = unProyecto();
        runs.save(TestRun.builder().project(p).runId("run-1").build());
        assertThatThrownBy(() -> runs.saveAndFlush(TestRun.builder().project(p).runId("run-1").build()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void elMismoRunIdSiPuedeExistirEnProyectosDistintos() {
        Project a = unProyecto();
        Project b = projects.save(Project.builder().name("Medical").repoUrl("https://git/med.git").build());
        runs.save(TestRun.builder().project(a).runId("run-1").build());
        runs.saveAndFlush(TestRun.builder().project(b).runId("run-1").build());
        assertThat(runs.findAll()).hasSize(2);
    }
}
```

- [ ] **Step 5: Correr y commitear**

Run: `mvn test` → PASS (9 + 3 = 12).

```bash
git add src/main/java/com/royalnet/qareports/entity src/main/java/com/royalnet/qareports/repository src/test/java/com/royalnet/qareports/repository
git commit -m "feat(ingest): entidades TestRun y TestResult con idempotencia por runId"
```

---

### Task 5: `POST /api/sync/modules` — sincronizar el catálogo desde el repo

**Files:**
- Modify: `src/main/java/com/royalnet/qareports/dto/Dtos.java`
- Create: `src/main/java/com/royalnet/qareports/service/IngestService.java`
- Create: `src/main/java/com/royalnet/qareports/controller/IngestController.java`
- Test: `src/test/java/com/royalnet/qareports/ingest/SyncModulesTest.java`

**Interfaces:**
- Consumes: `ProjectRepository`, `QaModuleRepository` (Task 3).
- Produces: `IngestService.syncModules(SyncModulesRequest)` → `Project`; `QaModuleRepository.findByProjectAndName(Project, String)` → `Optional<QaModule>` (se añade aquí y la usa la Task 6).

- [ ] **Step 1: Añadir los DTOs**

En `dto/Dtos.java`, antes de la sección `// ─── Generic ───`:

```java
    // ─── Ingesta ─────────────────────────────────────────────────────────────

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class SyncModulesRequest {
        @NotBlank @Size(max=500) private String repoUrl;
        @NotBlank @Size(max=150) private String projectName;
        private List<String> modules;
    }
```

- [ ] **Step 2: Añadir el finder al repositorio de módulos**

En `repository/QaModuleRepository.java`, añadir dentro de la interfaz:

```java
    Optional<QaModule> findByProjectAndName(Project project, String name);
```

y los imports que falten:

```java
import com.royalnet.qareports.entity.Project;
import java.util.Optional;
```

- [ ] **Step 3: Crear `IngestService` con la sincronización**

`src/main/java/com/royalnet/qareports/service/IngestService.java`:

```java
package com.royalnet.qareports.service;

import com.royalnet.qareports.dto.Dtos.SyncModulesRequest;
import com.royalnet.qareports.entity.Project;
import com.royalnet.qareports.entity.QaModule;
import com.royalnet.qareports.enums.ModuleStatus;
import com.royalnet.qareports.repository.ProjectRepository;
import com.royalnet.qareports.repository.QaModuleRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
@Slf4j
@Transactional
public class IngestService {

    private final ProjectRepository projectRepository;
    private final QaModuleRepository moduleRepository;

    /** El repo es la fuente de verdad: si no conocemos el proyecto, se crea. */
    public Project resolveProject(String repoUrl, String projectName) {
        return projectRepository.findByRepoUrl(repoUrl)
                .orElseGet(() -> projectRepository.save(Project.builder()
                        .name(projectName != null && !projectName.isBlank() ? projectName : repoUrl)
                        .repoUrl(repoUrl)
                        .build()));
    }

    /** Crea los módulos que falten. No borra los que dejen de aparecer: se llevarían assignee, estado e historial. */
    public Project syncModules(SyncModulesRequest req) {
        Project project = resolveProject(req.getRepoUrl(), req.getProjectName());
        List<String> names = req.getModules() != null ? req.getModules() : List.of();

        for (String name : names) {
            if (name == null || name.isBlank()) continue;
            resolveModule(project, name.trim());
        }
        return project;
    }

    /** Devuelve el módulo del proyecto, creándolo si es la primera vez que aparece. */
    public QaModule resolveModule(Project project, String name) {
        return moduleRepository.findByProjectAndName(project, name)
                .orElseGet(() -> {
                    log.info("Módulo nuevo detectado desde el repo: {} / {}", project.getName(), name);
                    return moduleRepository.save(QaModule.builder()
                            .project(project)
                            .name(name)
                            .status(ModuleStatus.NOT_STARTED)
                            .coverage(0)
                            .build());
                });
    }
}
```

- [ ] **Step 4: Crear el controlador**

`src/main/java/com/royalnet/qareports/controller/IngestController.java`:

```java
package com.royalnet.qareports.controller;

import com.royalnet.qareports.dto.Dtos.*;
import com.royalnet.qareports.service.IngestService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class IngestController {

    private final IngestService ingestService;

    @PostMapping("/sync/modules")
    public ResponseEntity<ApiResponse<String>> syncModules(@Valid @RequestBody SyncModulesRequest req) {
        var project = ingestService.syncModules(req);
        return ResponseEntity.ok(ApiResponse.ok("Catálogo sincronizado", project.getName()));
    }
}
```

- [ ] **Step 5: Escribir el test**

`src/test/java/com/royalnet/qareports/ingest/SyncModulesTest.java`:

```java
package com.royalnet.qareports.ingest;

import com.royalnet.qareports.TestSupport;
import com.royalnet.qareports.dto.Dtos.SyncModulesRequest;
import com.royalnet.qareports.entity.Project;
import com.royalnet.qareports.repository.ProjectRepository;
import com.royalnet.qareports.repository.QaModuleRepository;
import com.royalnet.qareports.service.IngestService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
@Import(TestSupport.class)
class SyncModulesTest {

    @Autowired private IngestService ingest;
    @Autowired private ProjectRepository projects;
    @Autowired private QaModuleRepository modules;

    private SyncModulesRequest req(String repoUrl, List<String> mods) {
        return SyncModulesRequest.builder().repoUrl(repoUrl).projectName("ERP").modules(mods).build();
    }

    @Test
    void creaElProyectoYSusModulosLaPrimeraVez() {
        ingest.syncModules(req("https://git/sync1.git", List.of("atenciones", "facturacion")));

        Project p = projects.findByRepoUrl("https://git/sync1.git").orElseThrow();
        assertThat(modules.findByProjectAndName(p, "atenciones")).isPresent();
        assertThat(modules.findByProjectAndName(p, "facturacion")).isPresent();
    }

    @Test
    void sincronizarDosVecesNoDuplica() {
        ingest.syncModules(req("https://git/sync2.git", List.of("atenciones")));
        ingest.syncModules(req("https://git/sync2.git", List.of("atenciones")));

        Project p = projects.findByRepoUrl("https://git/sync2.git").orElseThrow();
        assertThat(modules.findAll().stream()
                .filter(m -> m.getProject() != null && m.getProject().getId().equals(p.getId()))
                .toList()).hasSize(1);
    }

    @Test
    void noBorraLosModulosQueDejanDeAparecer() {
        ingest.syncModules(req("https://git/sync3.git", List.of("atenciones", "facturacion")));
        ingest.syncModules(req("https://git/sync3.git", List.of("atenciones")));

        Project p = projects.findByRepoUrl("https://git/sync3.git").orElseThrow();
        assertThat(modules.findByProjectAndName(p, "facturacion")).isPresent();
    }

    @Test
    void elProyectoSeReusaSiLaRepoUrlYaExiste() {
        ingest.syncModules(req("https://git/sync4.git", List.of("a")));
        ingest.syncModules(req("https://git/sync4.git", List.of("b")));
        assertThat(projects.findAll().stream().filter(x -> x.getRepoUrl().equals("https://git/sync4.git")).toList()).hasSize(1);
    }
}
```

- [ ] **Step 6: Correr y commitear**

Run: `mvn test` → PASS (12 + 4 = 16).

```bash
git add src/main/java/com/royalnet/qareports src/test/java/com/royalnet/qareports/ingest
git commit -m "feat(ingest): endpoint de sincronización del catálogo de módulos desde el repo"
```

---

### Task 6: `POST /api/runs` — ingesta de una corrida

**Files:**
- Modify: `src/main/java/com/royalnet/qareports/dto/Dtos.java`
- Modify: `src/main/java/com/royalnet/qareports/service/IngestService.java`
- Modify: `src/main/java/com/royalnet/qareports/controller/IngestController.java`
- Test: `src/test/java/com/royalnet/qareports/ingest/IngestRunTest.java`

**Interfaces:**
- Consumes: `TestIdParser` (Task 2), `TestRun`/`TestResult` y sus repositorios (Task 4), `resolveProject`/`resolveModule` (Task 5), `UserRepository` (existente).
- Produces: `IngestService.ingestRun(RunRequest, String username)` → `boolean` (`true` = creada, `false` = ya existía).

- [ ] **Step 1: Añadir los DTOs**

En `dto/Dtos.java`, debajo de `SyncModulesRequest`:

```java
    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class RunTestDto {
        private String id;
        private String name;
        private String status;
        private Long durationMs;
        private String error;
        private Integer retry;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class RunRequest {
        @NotBlank @Size(max=100)  private String runId;
        @NotBlank @Size(max=500)  private String repoUrl;
        @Size(max=150)            private String projectName;
        private LocalDateTime startedAt;
        private LocalDateTime finishedAt;
        @Size(max=20)             private String mode;
        private Integer total;
        private Integer passed;
        private Integer failed;
        private Integer skipped;
        private Long durationMs;
        private boolean discardedByQa;
        private List<RunTestDto> tests;
    }
```

- [ ] **Step 2: Implementar la ingesta en `IngestService`**

Añadir los campos y el método en `service/IngestService.java`. Los campos nuevos van junto a los existentes:

```java
    private final TestRunRepository runRepository;
    private final TestResultRepository resultRepository;
    private final UserRepository userRepository;
```

con los imports:

```java
import com.royalnet.qareports.dto.Dtos.RunRequest;
import com.royalnet.qareports.dto.Dtos.RunTestDto;
import com.royalnet.qareports.entity.TestResult;
import com.royalnet.qareports.entity.TestRun;
import com.royalnet.qareports.entity.User;
import com.royalnet.qareports.ingest.TestIdParser;
import com.royalnet.qareports.repository.TestResultRepository;
import com.royalnet.qareports.repository.TestRunRepository;
import com.royalnet.qareports.repository.UserRepository;
```

y el método:

```java
    /**
     * Persiste una corrida. Devuelve false si ya estaba (reenvío): el cliente
     * borra igual de su cola. El QA sale del JWT, nunca del cuerpo.
     */
    public boolean ingestRun(RunRequest req, String username) {
        Project project = resolveProject(req.getRepoUrl(), req.getProjectName());

        if (runRepository.findByProjectAndRunId(project, req.getRunId()).isPresent()) {
            log.debug("Corrida {} ya registrada para {}: se ignora el reenvío", req.getRunId(), project.getName());
            return false;
        }

        User user = userRepository.findByUsername(username).orElse(null);

        TestRun run = runRepository.save(TestRun.builder()
                .runId(req.getRunId())
                .project(project)
                .user(user)
                .startedAt(req.getStartedAt())
                .finishedAt(req.getFinishedAt())
                .mode(req.getMode())
                .total(req.getTotal())
                .passed(req.getPassed())
                .failed(req.getFailed())
                .skipped(req.getSkipped())
                .durationMs(req.getDurationMs())
                .discardedByQa(req.isDiscardedByQa())
                .build());

        List<RunTestDto> tests = req.getTests() != null ? req.getTests() : List.of();
        for (RunTestDto t : tests) {
            String folder = TestIdParser.moduleFolderOf(t.getId());
            resultRepository.save(TestResult.builder()
                    .run(run)
                    .module(folder != null ? resolveModule(project, folder) : null)
                    .testId(t.getId())
                    .specFile(TestIdParser.specFileOf(t.getId()))
                    .name(t.getName())
                    .status(t.getStatus())
                    .durationMs(t.getDurationMs())
                    .error(t.getError())
                    .flaky(t.getRetry() != null && t.getRetry() > 0)
                    .build());
        }
        return true;
    }
```

- [ ] **Step 3: Añadir el endpoint**

En `controller/IngestController.java`, añadir el import y el método:

```java
import org.springframework.security.core.Authentication;
```

```java
    @PostMapping("/runs")
    public ResponseEntity<ApiResponse<String>> ingestRun(@Valid @RequestBody RunRequest req,
                                                        Authentication auth) {
        boolean created = ingestService.ingestRun(req, auth.getName());
        if (!created) return ResponseEntity.noContent().build();
        return ResponseEntity.ok(ApiResponse.ok("Corrida registrada", req.getRunId()));
    }
```

- [ ] **Step 4: Escribir el test**

`src/test/java/com/royalnet/qareports/ingest/IngestRunTest.java`:

```java
package com.royalnet.qareports.ingest;

import com.royalnet.qareports.TestSupport;
import com.royalnet.qareports.dto.Dtos.RunRequest;
import com.royalnet.qareports.dto.Dtos.RunTestDto;
import com.royalnet.qareports.entity.Project;
import com.royalnet.qareports.entity.TestResult;
import com.royalnet.qareports.repository.*;
import com.royalnet.qareports.service.IngestService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
@Import(TestSupport.class)
class IngestRunTest {

    @Autowired private IngestService ingest;
    @Autowired private ProjectRepository projects;
    @Autowired private QaModuleRepository modules;
    @Autowired private TestRunRepository runs;
    @Autowired private TestResultRepository results;

    private RunRequest run(String repoUrl, String runId, List<RunTestDto> tests) {
        return RunRequest.builder()
                .runId(runId).repoUrl(repoUrl).projectName("ERP")
                .mode("conjunto").total(tests.size()).passed(tests.size())
                .failed(0).skipped(0).durationMs(1000L).discardedByQa(false)
                .tests(tests).build();
    }

    private RunTestDto test(String id, String status, Integer retry) {
        return RunTestDto.builder().id(id).name("un test").status(status)
                .durationMs(10L).error(null).retry(retry).build();
    }

    @Test
    void guardaLaCorridaYAtribuyeCadaTestASuModulo() {
        ingest.ingestRun(run("https://git/r1.git", "run-1",
                List.of(test("atenciones/cobros.spec.ts:12", "passed", null))), "admin");

        Project p = projects.findByRepoUrl("https://git/r1.git").orElseThrow();
        assertThat(runs.findByProjectAndRunId(p, "run-1")).isPresent();

        var modulo = modules.findByProjectAndName(p, "atenciones").orElseThrow();
        List<TestResult> deEseModulo = results.findByModule(modulo);
        assertThat(deEseModulo).hasSize(1);
        assertThat(deEseModulo.get(0).getSpecFile()).isEqualTo("atenciones/cobros.spec.ts");
    }

    @Test
    void unSpecEnLaRaizQuedaSinModulo() {
        ingest.ingestRun(run("https://git/r2.git", "run-2",
                List.of(test("sin-refinar.spec.ts:3", "passed", null))), "admin");

        var todos = results.findAll().stream()
                .filter(r -> "sin-refinar.spec.ts:3".equals(r.getTestId())).toList();
        assertThat(todos).hasSize(1);
        assertThat(todos.get(0).getModule()).isNull();
    }

    @Test
    void elReenvioDelMismoRunIdNoDuplica() {
        var tests = List.of(test("atenciones/x.spec.ts:1", "passed", null));
        assertThat(ingest.ingestRun(run("https://git/r3.git", "run-3", tests), "admin")).isTrue();
        assertThat(ingest.ingestRun(run("https://git/r3.git", "run-3", tests), "admin")).isFalse();

        Project p = projects.findByRepoUrl("https://git/r3.git").orElseThrow();
        assertThat(runs.findAll().stream().filter(r -> r.getProject().getId().equals(p.getId())).toList()).hasSize(1);
    }

    @Test
    void unRetryMayorQueCeroMarcaElTestComoFlaky() {
        ingest.ingestRun(run("https://git/r4.git", "run-4",
                List.of(test("atenciones/flaky.spec.ts:5", "passed", 2))), "admin");

        var r = results.findAll().stream()
                .filter(x -> "atenciones/flaky.spec.ts:5".equals(x.getTestId())).findFirst().orElseThrow();
        assertThat(r.isFlaky()).isTrue();
    }

    @Test
    void elUsuarioSaleDelNombreRecibidoYNoDelCuerpo() {
        ingest.ingestRun(run("https://git/r5.git", "run-5",
                List.of(test("atenciones/x.spec.ts:1", "passed", null))), "admin");

        Project p = projects.findByRepoUrl("https://git/r5.git").orElseThrow();
        var corrida = runs.findByProjectAndRunId(p, "run-5").orElseThrow();
        assertThat(corrida.getUser()).isNotNull();
        assertThat(corrida.getUser().getUsername()).isEqualTo("admin");
    }
}
```

> El usuario `admin` lo siembra `DataInitializer` al arrancar el contexto.

- [ ] **Step 5: Correr y commitear**

Run: `mvn test` → PASS (16 + 5 = 21).

```bash
git add src/main/java/com/royalnet/qareports src/test/java/com/royalnet/qareports/ingest
git commit -m "feat(ingest): endpoint POST /api/runs con idempotencia y atribución por módulo"
```

---

### Task 7: Seguridad — cerrar el registro y proteger los endpoints nuevos

**Files:**
- Modify: `src/main/java/com/royalnet/qareports/config/SecurityConfig.java`
- Test: `src/test/java/com/royalnet/qareports/security/SecurityRulesTest.java`

**Interfaces:**
- Consumes: los endpoints de las Tasks 5 y 6.

- [ ] **Step 1: Ajustar las reglas**

En `config/SecurityConfig.java`, reemplazar la línea 46:

```java
                .requestMatchers("/api/auth/**").permitAll()
```

por:

```java
                // Solo el login es público; el alta de usuarios la hace el QA_LEAD.
                .requestMatchers(HttpMethod.POST, "/api/auth/login").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/auth/register").hasRole("QA_LEAD")
                // Ingesta desde los escritorios RunQA
                .requestMatchers(HttpMethod.POST, "/api/runs").hasAnyRole("QA_LEAD", "QA_ANALYST")
                .requestMatchers(HttpMethod.POST, "/api/sync/**").hasAnyRole("QA_LEAD", "QA_ANALYST")
```

- [ ] **Step 2: Escribir el test**

`src/test/java/com/royalnet/qareports/security/SecurityRulesTest.java`:

```java
package com.royalnet.qareports.security;

import com.royalnet.qareports.TestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(TestSupport.class)
class SecurityRulesTest {

    @Autowired private MockMvc mvc;

    private static final String NUEVO_USUARIO = """
        {"username":"nuevo","email":"n@royalnet.com","password":"Password1!","fullName":"Nuevo QA"}
        """;

    // Anónimo: sin authenticationEntryPoint explícito en SecurityConfig, Spring puede
    // responder 401 o 403. Lo que se verifica es que quede rechazado, no el código exacto.
    @Test
    void elRegistroAnonimoQuedaRechazado() throws Exception {
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content(NUEVO_USUARIO))
           .andExpect(status().is4xxClientError());
    }

    @Test
    @WithMockUser(username = "ana", roles = {"QA_ANALYST"})
    void unAnalistaNoPuedeRegistrarUsuarios() throws Exception {
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content(NUEVO_USUARIO))
           .andExpect(status().isForbidden());
    }

    @Test
    @WithMockUser(username = "lead", roles = {"QA_LEAD"})
    void elLeadSiPuedeRegistrarUsuarios() throws Exception {
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content(NUEVO_USUARIO))
           .andExpect(status().isOk());
    }

    @Test
    void laIngestaAnonimaQuedaRechazada() throws Exception {
        mvc.perform(post("/api/runs").contentType(MediaType.APPLICATION_JSON).content("{}"))
           .andExpect(status().is4xxClientError());
        mvc.perform(post("/api/sync/modules").contentType(MediaType.APPLICATION_JSON).content("{}"))
           .andExpect(status().is4xxClientError());
    }

    @Test
    void elLoginSigueSiendoPublico() throws Exception {
        // Credenciales incorrectas: 401 del handler, no 403 de autorización.
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\\"username\\":\\"noexiste\\",\\"password\\":\\"loquesea\\"}"))
           .andExpect(status().isUnauthorized());
    }
}
```

- [ ] **Step 3: Correr y commitear**

Run: `mvn test` → PASS (21 + 5 = 26).

```bash
git add src/main/java/com/royalnet/qareports/config/SecurityConfig.java src/test/java/com/royalnet/qareports/security
git commit -m "fix(security): cerrar el registro al QA_LEAD y proteger la ingesta"
```

---

### Task 8: `coverage` calculado desde los resultados

`QaModule.coverage` deja de escribirse a mano: pasa a ser el **porcentaje de pruebas del módulo cuyo último resultado conocido fue `passed`**. Mide salud de las pruebas, no porcentaje de flujos del negocio automatizados.

**Files:**
- Modify: `src/main/java/com/royalnet/qareports/service/IngestService.java`
- Modify: `src/main/java/com/royalnet/qareports/service/impl/QaModuleServiceImpl.java` (líneas 100-103)
- Test: `src/test/java/com/royalnet/qareports/ingest/CoverageTest.java`

**Interfaces:**
- Consumes: `TestResultRepository.findByModule` (Task 4).
- Produces: `IngestService.recalculateCoverage(QaModule)` → `int`.

- [ ] **Step 1: Implementar el cálculo**

En `service/IngestService.java`, añadir:

```java
    /**
     * Cobertura = % de pruebas del módulo cuyo ÚLTIMO resultado conocido fue passed.
     * Mide salud de las pruebas; no es "% de flujos del negocio automatizados".
     */
    public int recalculateCoverage(QaModule module) {
        List<TestResult> all = resultRepository.findByModule(module);
        Map<String, TestResult> ultimoPorTest = new HashMap<>();
        for (TestResult r : all) {
            TestResult previo = ultimoPorTest.get(r.getTestId());
            if (previo == null || r.getId() > previo.getId()) ultimoPorTest.put(r.getTestId(), r);
        }
        if (ultimoPorTest.isEmpty()) return module.getCoverage() != null ? module.getCoverage() : 0;

        long pasan = ultimoPorTest.values().stream().filter(r -> "passed".equals(r.getStatus())).count();
        int coverage = (int) Math.round(100.0 * pasan / ultimoPorTest.size());
        module.setCoverage(coverage);
        moduleRepository.save(module);
        return coverage;
    }
```

con los imports:

```java
import java.util.HashMap;
import java.util.Map;
```

- [ ] **Step 2: Recalcular al final de la ingesta**

Reemplazar el método `ingestRun` completo (Task 6, Step 2) por esta versión, que acumula los módulos tocados y recalcula su cobertura al terminar:

```java
    /**
     * Persiste una corrida. Devuelve false si ya estaba (reenvío): el cliente
     * borra igual de su cola. El QA sale del JWT, nunca del cuerpo.
     */
    public boolean ingestRun(RunRequest req, String username) {
        Project project = resolveProject(req.getRepoUrl(), req.getProjectName());

        if (runRepository.findByProjectAndRunId(project, req.getRunId()).isPresent()) {
            log.debug("Corrida {} ya registrada para {}: se ignora el reenvío", req.getRunId(), project.getName());
            return false;
        }

        User user = userRepository.findByUsername(username).orElse(null);

        TestRun run = runRepository.save(TestRun.builder()
                .runId(req.getRunId())
                .project(project)
                .user(user)
                .startedAt(req.getStartedAt())
                .finishedAt(req.getFinishedAt())
                .mode(req.getMode())
                .total(req.getTotal())
                .passed(req.getPassed())
                .failed(req.getFailed())
                .skipped(req.getSkipped())
                .durationMs(req.getDurationMs())
                .discardedByQa(req.isDiscardedByQa())
                .build());

        Set<QaModule> modulosTocados = new HashSet<>();
        List<RunTestDto> tests = req.getTests() != null ? req.getTests() : List.of();
        for (RunTestDto t : tests) {
            String folder = TestIdParser.moduleFolderOf(t.getId());
            QaModule modulo = folder != null ? resolveModule(project, folder) : null;
            if (modulo != null) modulosTocados.add(modulo);

            resultRepository.save(TestResult.builder()
                    .run(run)
                    .module(modulo)
                    .testId(t.getId())
                    .specFile(TestIdParser.specFileOf(t.getId()))
                    .name(t.getName())
                    .status(t.getStatus())
                    .durationMs(t.getDurationMs())
                    .error(t.getError())
                    .flaky(t.getRetry() != null && t.getRetry() > 0)
                    .build());
        }

        modulosTocados.forEach(this::recalculateCoverage);
        return true;
    }
```

Añadir a los imports de la clase:

```java
import java.util.HashSet;
import java.util.Set;
```

- [ ] **Step 3: Dejar de forzar `coverage = 100` al cerrar un módulo**

En `service/impl/QaModuleServiceImpl.java`, borrar el bloque de las líneas 100-103:

```java
        // Auto-completar cobertura al 100% si se marca como Terminado o Verificado
        if (request.getStatus() == ModuleStatus.DONE || request.getStatus() == ModuleStatus.VERIFIED) {
            module.setCoverage(100);
        }
```

- [ ] **Step 4: Escribir el test**

`src/test/java/com/royalnet/qareports/ingest/CoverageTest.java`:

```java
package com.royalnet.qareports.ingest;

import com.royalnet.qareports.TestSupport;
import com.royalnet.qareports.dto.Dtos.RunRequest;
import com.royalnet.qareports.dto.Dtos.RunTestDto;
import com.royalnet.qareports.entity.Project;
import com.royalnet.qareports.repository.ProjectRepository;
import com.royalnet.qareports.repository.QaModuleRepository;
import com.royalnet.qareports.service.IngestService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
@Import(TestSupport.class)
class CoverageTest {

    @Autowired private IngestService ingest;
    @Autowired private ProjectRepository projects;
    @Autowired private QaModuleRepository modules;

    private RunTestDto t(String id, String status) {
        return RunTestDto.builder().id(id).name("t").status(status).durationMs(1L).build();
    }

    private void correr(String repoUrl, String runId, List<RunTestDto> tests) {
        ingest.ingestRun(RunRequest.builder()
                .runId(runId).repoUrl(repoUrl).projectName("ERP").mode("conjunto")
                .total(tests.size()).tests(tests).build(), "admin");
    }

    @Test
    void dosDeCuatroPasandoDaCincuenta() {
        correr("https://git/cov1.git", "c1", List.of(
                t("atenciones/a.spec.ts:1", "passed"),
                t("atenciones/b.spec.ts:1", "passed"),
                t("atenciones/c.spec.ts:1", "failed"),
                t("atenciones/d.spec.ts:1", "failed")));

        Project p = projects.findByRepoUrl("https://git/cov1.git").orElseThrow();
        assertThat(modules.findByProjectAndName(p, "atenciones").orElseThrow().getCoverage()).isEqualTo(50);
    }

    @Test
    void soloCuentaElUltimoResultadoDeCadaTest() {
        correr("https://git/cov2.git", "c2a", List.of(t("atenciones/a.spec.ts:1", "failed")));
        correr("https://git/cov2.git", "c2b", List.of(t("atenciones/a.spec.ts:1", "passed")));

        Project p = projects.findByRepoUrl("https://git/cov2.git").orElseThrow();
        assertThat(modules.findByProjectAndName(p, "atenciones").orElseThrow().getCoverage()).isEqualTo(100);
    }
}
```

- [ ] **Step 5: Correr y commitear**

Run: `mvn test` → PASS (26 + 2 = 28).

```bash
git add src/main/java/com/royalnet/qareports src/test/java/com/royalnet/qareports/ingest
git commit -m "feat(ingest): coverage calculado desde el último resultado de cada prueba"
```

---

## Self-Review

**Cobertura del spec:**

- Tabla `Project` correlacionada por `repoUrl` → Task 3.
- `QaModule` colgando de `Project` con única `(project, name)` → Task 3.
- Catálogo sincronizado desde el repo, sin borrar lo ausente → Task 5.
- `TestRun` / `TestResult` con los campos del spec → Task 4.
- `POST /api/sync/modules` → Task 5; `POST /api/runs` → Task 6.
- Idempotencia por `(project, runId)` → Task 4 (restricción) + Task 6 (204).
- Usuario desde el JWT, no del cuerpo → Task 6 (`auth.getName()`) + test dedicado.
- Atribución por carpeta y `module = null` en la raíz → Task 2 + Task 6.
- `flaky` desde `retry` → Task 6.
- `receivedAt` del servidor → Task 4.
- Cerrar `/api/auth/register` dejando `login` público → Task 7.
- `coverage` calculado y dejar de forzarlo a 100 → Task 8.
- Proyecto creado si el repo no se conoce → Task 5 (`resolveProject`), usado por Task 6.

**Fuera de este plan (declarado):** migrar los endpoints de módulos existentes de `projectType` a `project` (queda como columna legado nullable); el cliente Electron va en un plan aparte.

**Consistencia de tipos/nombres:** `TestIdParser.specFileOf/moduleFolderOf` (Task 2) se usan igual en Task 6. `ProjectRepository.findByRepoUrl` (Task 3) lo usa `resolveProject` (Task 5). `QaModuleRepository.findByProjectAndName` se declara en Task 5 y lo usan Tasks 5, 6 y los tests de 6 y 8. `TestRunRepository.findByProjectAndRunId` (Task 4) lo usa Task 6. `TestResultRepository.findByModule` (Task 4) lo usa Task 8. `IngestService.resolveProject/resolveModule/ingestRun/recalculateCoverage` mantienen la misma firma entre las Tasks 5, 6 y 8. Los DTOs `SyncModulesRequest` (Task 5) y `RunRequest`/`RunTestDto` (Task 6) coinciden con lo que consumen el controlador y los tests.

**Riesgo señalado:** la Task 3 incluye SQL manual porque `ddl-auto: update` no relaja el `NOT NULL` de `project_type`; si la base es de desarrollo, recrearla es más simple.
