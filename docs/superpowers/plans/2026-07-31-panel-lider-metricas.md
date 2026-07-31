# Métricas del panel del líder — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el QA_LEAD abra una pestaña "Métricas" en el panel y vea, sobre las corridas reales, la salud general de las pruebas, el reparto por analista y por proyecto, y la tendencia de las últimas doce semanas.

**Architecture:** Un endpoint agregado nuevo, `GET /api/runs/stats`, que trae todas las corridas no descartadas y las agrega en Java con una clase pura sin dependencias de Spring ni de la base. En el frontend, la pantalla ya maquetada (`ReportsTab.jsx`, hoy alimentada por el seed) se renombra a `MetricsTab.jsx` y se conecta al endpoint. **Las tareas 1-6 son del backend, las 7-9 del frontend**; el frontend puede arrancar apenas la Task 1 fije los nombres del JSON.

**Tech Stack:** Spring Boot 3.2.5 / Java 17, Spring Data JPA, PostgreSQL (Neon), JUnit 5 + MockMvc + AssertJ; React 18 + Vite 5, sin librerías nuevas.

## Global Constraints

- El spec es [2026-07-31-panel-lider-metricas-design.md](../specs/2026-07-31-panel-lider-metricas-design.md). El contrato JSON de ahí es **la fuente de verdad**: si una tarea necesita cambiarlo, se para y se avisa, no se improvisa.
- **Precondición: la rebanada 1 tiene que estar desplegada.** La rama `panel-lider` mergeada a `main` y pusheada, el backend vivo en Render y el panel publicado como Static Site con el CORS abierto. Este plan arranca desde `main` con ese merge ya hecho.
- **Tres directorios, todos con un espacio en `Proyectos /`** — van entre comillas siempre:
  - Backend: `~/Escritorio/Proyectos /SpringComuTestQa/ReportRas_Backe`
  - Frontend: `~/Escritorio/Proyectos /SpringComuTestQa/Frontend_RasiReport`
  - Specs y planes: `~/Escritorio/Proyectos /TestQA/Qa_test_ejec/docs/superpowers/`
- **`JAVA_HOME` es obligatorio para TODO comando Maven:**

  ```bash
  export JAVA_HOME=~/.jdks/jdk-21.0.12+8
  ```

  Sin esto, una compilación desde cero falla con `release version 17 not supported`: el JVM sobre el que arranca Maven es un JRE sin `javac`, así que el plugin delega en `/usr/bin/javac`, que es Java 8. Un `mvn test` con `target/` ya compilado *parece* funcionar sin la variable porque no recompila: **eso es un falso verde**.
- **Líneas base:** backend `mvn test` = **42/42** (rama `panel-lider`). El frontend **no tiene infraestructura de tests y no se le agrega**; se verifica con `npm run build` y a mano.
- **Sin dependencias nuevas** en `pom.xml` ni en `package.json`.
- Todo el copy de la UI y los mensajes de log **en español neutro**, como el resto de ambos repositorios.
- **Commits:** cada tarea termina en commit. **Pushear a GitHub NO está autorizado**: el usuario pushea por su cuenta.
- Los DTOs se escriben con `@Data @Builder @NoArgsConstructor @AllArgsConstructor`, como el resto de `Dtos.java`. No se usan `record`s: el archivo no los usa en ningún lado.

## Estructura de archivos

**Backend** (`src/main/java/com/royalnet/qareports/`):

| Archivo | Responsabilidad |
|---|---|
| `dto/Dtos.java` (modificar) | Los cinco DTOs de métricas, en su propia sección |
| `repository/TestRunRepository.java` (modificar) | Una consulta que trae todas las corridas con proyecto y usuario |
| `service/RunStatsAggregator.java` (crear) | Agregación pura: recibe la lista de corridas, devuelve los bloques. Sin Spring, sin base |
| `service/RunStatsService.java` (crear) | Une repositorio y agregador dentro de una transacción de lectura |
| `controller/RunController.java` (modificar) | El endpoint |

`RunStatsAggregator` va separado de `RunStatsService` para que los casos de borde —que son casi toda la complejidad— se prueben con listas armadas a mano, sin `@SpringBootTest` ni base de datos. `RunStatsService` queda tan fino que no necesita test propio: lo cubre el test de controlador.

**Frontend** (`src/`):

| Archivo | Responsabilidad |
|---|---|
| `api/runs.js` (modificar) | `getRunStats()` |
| `screens/ReportsTab.jsx` → `screens/MetricsTab.jsx` (`git mv` + reescribir) | La pantalla |
| `components/Sidebar.jsx` (modificar) | Segundo ítem de navegación |
| `screens/MainApp.jsx` (modificar) | Renderizar `tab === 'metrics'` |

---

### Task 1: Los DTOs de métricas

**Files:**
- Modify: `src/main/java/com/royalnet/qareports/dto/Dtos.java` (agregar sección al final, antes de `// ─── Generic ───`)
- Test: `src/test/java/com/royalnet/qareports/dto/RunStatsJsonTest.java` (crear)

**Interfaces:**
- Consumes: nada.
- Produces, para las tareas 2-7: las clases `Dtos.RunStats`, `Dtos.StatsGeneral`, `Dtos.StatsByUser`, `Dtos.StatsByProject`, `Dtos.StatsTrendPoint`, con exactamente los campos de abajo.

**Contexto:** `Dtos.java` es una clase contenedora con clases estáticas anidadas agrupadas por secciones con comentarios `// ─── Nombre ───`. Los campos anulables se escriben con tipos envoltorio (`Double`, `Long`), nunca primitivos: un `double` no puede ser `null` y el contrato exige `null` para distinguir "no hay datos" de "cero".

- [ ] **Step 1: Escribir el test que falla**

Crear `src/test/java/com/royalnet/qareports/dto/RunStatsJsonTest.java`:

```java
package com.royalnet.qareports.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.royalnet.qareports.dto.Dtos.RunStats;
import com.royalnet.qareports.dto.Dtos.StatsGeneral;
import com.royalnet.qareports.dto.Dtos.StatsTrendPoint;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
class RunStatsJsonTest {

    @Autowired private ObjectMapper mapper;

    @Test
    void laSemanaSeSerializaComoFechaSinHora() throws Exception {
        StatsTrendPoint punto = StatsTrendPoint.builder()
                .weekStart(LocalDate.of(2026, 5, 11)).runs(9).passRate(0.91).build();

        assertThat(mapper.writeValueAsString(punto)).contains("\"weekStart\":\"2026-05-11\"");
    }

    @Test
    void elPassRateNuloViajaComoNullYNoComoCero() throws Exception {
        RunStats stats = RunStats.builder()
                .general(StatsGeneral.builder()
                        .totalRuns(0).passRate(null).runsWithFailures(0)
                        .avgDurationMs(null).passed(0).failed(0).skipped(0).build())
                .byUser(List.of()).byProject(List.of())
                .trend(List.of(StatsTrendPoint.builder()
                        .weekStart(LocalDate.of(2026, 5, 11)).runs(0).passRate(null).build()))
                .build();

        String json = mapper.writeValueAsString(stats);

        assertThat(json).contains("\"passRate\":null");
        assertThat(json).contains("\"avgDurationMs\":null");
        assertThat(json).doesNotContain("\"passRate\":0.0");
    }
}
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test -Dtest=RunStatsJsonTest`
Expected: FALLA al compilar, con `cannot find symbol: class RunStats`.

- [ ] **Step 3: Agregar los DTOs**

En `src/main/java/com/royalnet/qareports/dto/Dtos.java`, insertar **antes** de la línea `// ─── Generic ───`:

```java
    // ─── Métricas (panel del líder) ──────────────────────────────────────────

    /** Nulos donde no hay datos: `null` significa "no se puede calcular", 0 significa "midió cero". */
    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class StatsGeneral {
        private long totalRuns;
        private Double passRate;
        private long runsWithFailures;
        private Long avgDurationMs;
        private long passed;
        private long failed;
        private long skipped;
    }

    /** username y fullName van en null para el grupo de corridas sin usuario. */
    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class StatsByUser {
        private String username;
        private String fullName;
        private long runs;
        private Double passRate;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class StatsByProject {
        private Long projectId;
        private String name;
        private long runs;
        private Double passRate;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class StatsTrendPoint {
        private LocalDate weekStart;
        private long runs;
        private Double passRate;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class RunStats {
        private StatsGeneral general;
        private List<StatsByUser> byUser;
        private List<StatsByProject> byProject;
        private List<StatsTrendPoint> trend;
    }
```

Agregar el import de `LocalDate` junto a los que ya están arriba del archivo:

```java
import java.time.LocalDate;
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test -Dtest=RunStatsJsonTest`
Expected: PASA, 2 tests.

Si `weekStart` sale como `[2026,5,11]`, falta la configuración de Jackson para fechas ISO. **No la agregues acá**: `JacksonDatesTest` ya la fija para el resto de la API, así que si esto falla hay algo roto de antes y corresponde parar y avisar.

- [ ] **Step 5: Correr la suite completa**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test`
Expected: 44/44 (los 42 de la línea base más los 2 nuevos).

- [ ] **Step 6: Commit**

```bash
git add src/main/java/com/royalnet/qareports/dto/Dtos.java src/test/java/com/royalnet/qareports/dto/RunStatsJsonTest.java
git commit -m "feat(dto): DTOs de métricas del panel del líder"
```

---

### Task 2: La consulta del repositorio

**Files:**
- Modify: `src/main/java/com/royalnet/qareports/repository/TestRunRepository.java`
- Test: `src/test/java/com/royalnet/qareports/repository/TestRunRepositoryTest.java` (modificar — **el archivo YA EXISTE** con tests de la línea base; se le agrega un método, no se lo reescribe)

**Interfaces:**
- Consumes: nada de la Task 1.
- Produces, para la Task 6: `List<TestRun> findAllWithProjectAndUser()` en `TestRunRepository`.

**Contexto:** el repositorio ya usa `@EntityGraph(attributePaths = {"project", "user"})` en sus consultas paginadas para no disparar una consulta por corrida. Acá hace falta lo mismo pero sin paginar, porque la agregación necesita todas las corridas. **La consulta NO filtra las descartadas**: ese filtro vive en el agregador (Task 3), donde se puede probar sin base de datos.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `src/test/java/com/royalnet/qareports/repository/TestRunRepositoryTest.java`, dentro de la clase:

```java
    @Test
    void findAllWithProjectAndUser_traeTodasLasCorridasIncluidasLasDescartadas() {
        Project proyecto = projectRepository.save(Project.builder()
                .name("ERP").repoUrl("https://git/erp-" + System.nanoTime() + ".git").active(true).build());

        runRepository.save(TestRun.builder().project(proyecto).runId("normal-" + System.nanoTime())
                .total(2).passed(2).failed(0).skipped(0).durationMs(1000L).build());
        runRepository.save(TestRun.builder().project(proyecto).runId("descartada-" + System.nanoTime())
                .total(2).passed(0).failed(2).skipped(0).durationMs(1000L).discardedByQa(true).build());

        List<TestRun> todas = runRepository.findAllWithProjectAndUser();

        assertThat(todas).hasSizeGreaterThanOrEqualTo(2);
        assertThat(todas).anyMatch(TestRun::isDiscardedByQa);
        // El @EntityGraph tiene que haber traído el proyecto: sin él, esto explota
        // con LazyInitializationException fuera de la transacción.
        assertThat(todas.get(0).getProject().getName()).isNotBlank();
    }
```

Si al archivo le faltan imports para `List` o `assertThat`, agregarlos.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test -Dtest=TestRunRepositoryTest`
Expected: FALLA al compilar, con `cannot find symbol: method findAllWithProjectAndUser()`.

- [ ] **Step 3: Agregar la consulta**

En `src/main/java/com/royalnet/qareports/repository/TestRunRepository.java`, agregar dentro de la interfaz:

```java
    // Sin paginar y con el grafo: la agregación de métricas necesita todas las
    // corridas, y sin @EntityGraph cada una dispararía dos consultas más para
    // traer su proyecto y su usuario.
    // No filtra las descartadas a propósito: ese descarte se decide en
    // RunStatsAggregator, donde se puede probar sin levantar una base.
    @EntityGraph(attributePaths = {"project", "user"})
    List<TestRun> findAllWithProjectAndUser();
```

Agregar el import:

```java
import java.util.List;
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test -Dtest=TestRunRepositoryTest`
Expected: PASA.

- [ ] **Step 5: Correr la suite completa**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test`
Expected: 45/45.

- [ ] **Step 6: Commit**

```bash
git add src/main/java/com/royalnet/qareports/repository/TestRunRepository.java src/test/java/com/royalnet/qareports/repository/TestRunRepositoryTest.java
git commit -m "feat(repo): consulta sin paginar de corridas con proyecto y usuario"
```

---

### Task 3: El bloque `general`

**Files:**
- Create: `src/main/java/com/royalnet/qareports/service/RunStatsAggregator.java`
- Test: `src/test/java/com/royalnet/qareports/service/RunStatsAggregatorTest.java` (crear)

**Interfaces:**
- Consumes: `Dtos.StatsGeneral` de la Task 1.
- Produces, para las tareas 4-6:
  - `static StatsGeneral general(List<TestRun> runs)`
  - `static List<TestRun> vigentes(List<TestRun> runs)` — descarta las marcadas por el QA
  - `static Double passRate(long passed, long failed)` — `null` si el denominador es cero

**Contexto:** ésta es la clase donde vive toda la complejidad del feature, y es pura a propósito: métodos estáticos, sin Spring, sin base de datos. `TestRun` trae `passed`, `failed`, `skipped`, `durationMs` y `total` como envoltorios anulables — la ingesta puede no mandarlos —, así que todo se lee con un helper que convierte `null` en 0.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/test/java/com/royalnet/qareports/service/RunStatsAggregatorTest.java`:

```java
package com.royalnet.qareports.service;

import com.royalnet.qareports.dto.Dtos.StatsGeneral;
import com.royalnet.qareports.entity.TestRun;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

class RunStatsAggregatorTest {

    /** Corrida mínima: solo lo que las métricas leen. */
    static TestRun run(int passed, int failed, int skipped, Long durationMs) {
        return TestRun.builder()
                .passed(passed).failed(failed).skipped(skipped)
                .total(passed + failed + skipped).durationMs(durationMs)
                .build();
    }

    @Test
    void passRate_noCuentaLosSalteadosEnElDenominador() {
        // 8 pasaron, 2 fallaron, 90 salteados: la tasa es 80%, no 8%.
        StatsGeneral g = RunStatsAggregator.general(List.of(run(8, 2, 90, 1000L)));

        assertThat(g.getPassRate()).isCloseTo(0.8, within(0.0001));
    }

    @Test
    void passRate_esNuloCuandoNoSeEjecutoNada() {
        StatsGeneral g = RunStatsAggregator.general(List.of(run(0, 0, 5, 1000L)));

        assertThat(g.getPassRate()).isNull();
    }

    @Test
    void general_ignoraLasCorridasDescartadasPorElQa() {
        TestRun descartada = run(0, 10, 0, 1000L);
        descartada.setDiscardedByQa(true);

        StatsGeneral g = RunStatsAggregator.general(List.of(run(10, 0, 0, 1000L), descartada));

        assertThat(g.getTotalRuns()).isEqualTo(1);
        assertThat(g.getPassRate()).isEqualTo(1.0);
        assertThat(g.getFailed()).isZero();
    }

    @Test
    void general_cuentaLasCorridasQueTuvieronAlMenosUnFallo() {
        StatsGeneral g = RunStatsAggregator.general(List.of(
                run(10, 0, 0, 1000L), run(9, 1, 0, 1000L), run(8, 2, 0, 1000L)));

        assertThat(g.getTotalRuns()).isEqualTo(3);
        assertThat(g.getRunsWithFailures()).isEqualTo(2);
    }

    @Test
    void avgDurationMs_ignoraLasCorridasSinDuracion() {
        StatsGeneral g = RunStatsAggregator.general(List.of(
                run(1, 0, 0, 1000L), run(1, 0, 0, 3000L), run(1, 0, 0, null)));

        assertThat(g.getAvgDurationMs()).isEqualTo(2000L);
    }

    @Test
    void general_sinCorridasDevuelveCerosYNulos() {
        StatsGeneral g = RunStatsAggregator.general(List.of());

        assertThat(g.getTotalRuns()).isZero();
        assertThat(g.getPassRate()).isNull();
        assertThat(g.getAvgDurationMs()).isNull();
        assertThat(g.getPassed()).isZero();
    }
}
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test -Dtest=RunStatsAggregatorTest`
Expected: FALLA al compilar, con `cannot find symbol: class RunStatsAggregator`.

- [ ] **Step 3: Escribir el agregador**

Crear `src/main/java/com/royalnet/qareports/service/RunStatsAggregator.java`:

```java
package com.royalnet.qareports.service;

import com.royalnet.qareports.dto.Dtos.StatsGeneral;
import com.royalnet.qareports.entity.TestRun;

import java.util.List;

/**
 * Agregación de métricas de corridas. Todo estático y sin dependencias: la
 * complejidad del feature vive acá y se prueba con listas armadas a mano, sin
 * Spring ni base de datos.
 */
public final class RunStatsAggregator {

    private RunStatsAggregator() {}

    /** Las corridas que el QA descartó en su equipo no cuentan en ninguna métrica. */
    public static List<TestRun> vigentes(List<TestRun> runs) {
        return runs.stream().filter(r -> !r.isDiscardedByQa()).toList();
    }

    /**
     * Los salteados quedan fuera del denominador: un test que no corrió no
     * aprobó ni falló. Es la misma regla que usa RunQA en main/results/metrics.js.
     * Devuelve null —y no cero— cuando no se ejecutó nada: cero significaría
     * "todo falló".
     */
    public static Double passRate(long passed, long failed) {
        long ejecutadas = passed + failed;
        return ejecutadas == 0 ? null : (double) passed / ejecutadas;
    }

    static long n(Integer valor) {
        return valor == null ? 0L : valor;
    }

    public static StatsGeneral general(List<TestRun> runs) {
        List<TestRun> vigentes = vigentes(runs);

        long passed = vigentes.stream().mapToLong(r -> n(r.getPassed())).sum();
        long failed = vigentes.stream().mapToLong(r -> n(r.getFailed())).sum();
        long skipped = vigentes.stream().mapToLong(r -> n(r.getSkipped())).sum();

        List<Long> duraciones = vigentes.stream()
                .map(TestRun::getDurationMs).filter(d -> d != null).toList();
        Long promedio = duraciones.isEmpty() ? null
                : Math.round(duraciones.stream().mapToLong(Long::longValue).average().orElse(0));

        return StatsGeneral.builder()
                .totalRuns(vigentes.size())
                .passRate(passRate(passed, failed))
                .runsWithFailures(vigentes.stream().filter(r -> n(r.getFailed()) > 0).count())
                .avgDurationMs(promedio)
                .passed(passed).failed(failed).skipped(skipped)
                .build();
    }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test -Dtest=RunStatsAggregatorTest`
Expected: PASA, 6 tests.

- [ ] **Step 5: Correr la suite completa**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test`
Expected: 51/51.

- [ ] **Step 6: Commit**

```bash
git add src/main/java/com/royalnet/qareports/service/RunStatsAggregator.java src/test/java/com/royalnet/qareports/service/RunStatsAggregatorTest.java
git commit -m "feat(metricas): agregación del bloque general"
```

---

### Task 4: Los bloques `byUser` y `byProject`

**Files:**
- Modify: `src/main/java/com/royalnet/qareports/service/RunStatsAggregator.java`
- Test: `src/test/java/com/royalnet/qareports/service/RunStatsAggregatorTest.java`

**Interfaces:**
- Consumes: `vigentes`, `passRate` y `n` de la Task 3; `Dtos.StatsByUser` y `Dtos.StatsByProject` de la Task 1.
- Produces, para la Task 6:
  - `static List<StatsByUser> byUser(List<TestRun> runs)`
  - `static List<StatsByProject> byProject(List<TestRun> runs)`

**Contexto:** `TestRun.user` es un `@ManyToOne` opcional y puede venir en `null` —`IngestService` guarda la corrida aunque el usuario no exista—. Esas corridas van a un grupo con `username` y `fullName` en `null`, que el frontend rotula "Sin identificar". Si se descartaran, la suma de `byUser` no cerraría con `general.totalRuns` y el tablero perdería credibilidad. `TestRun.project` en cambio es `optional = false`: siempre está.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `RunStatsAggregatorTest`, dentro de la clase:

```java
    static TestRun runDe(com.royalnet.qareports.entity.User usuario,
                         com.royalnet.qareports.entity.Project proyecto,
                         int passed, int failed) {
        TestRun r = run(passed, failed, 0, 1000L);
        r.setUser(usuario);
        r.setProject(proyecto);
        return r;
    }

    static com.royalnet.qareports.entity.User usuario(String username, String fullName) {
        return com.royalnet.qareports.entity.User.builder()
                .username(username).fullName(fullName).build();
    }

    static com.royalnet.qareports.entity.Project proyecto(Long id, String nombre) {
        return com.royalnet.qareports.entity.Project.builder().id(id).name(nombre).build();
    }

    @Test
    void byUser_agrupaPorUsuarioYCalculaSuTasa() {
        var nelson = usuario("nrosas", "Nelson Rosas");
        var ana = usuario("aperez", "Ana Pérez");

        var porUsuario = RunStatsAggregator.byUser(List.of(
                runDe(nelson, proyecto(1L, "ERP"), 9, 1),
                runDe(nelson, proyecto(1L, "ERP"), 9, 1),
                runDe(ana, proyecto(1L, "ERP"), 5, 5)));

        assertThat(porUsuario).hasSize(2);
        assertThat(porUsuario.get(0).getUsername()).isEqualTo("nrosas");
        assertThat(porUsuario.get(0).getRuns()).isEqualTo(2);
        assertThat(porUsuario.get(0).getPassRate()).isCloseTo(0.9, within(0.0001));
        assertThat(porUsuario.get(1).getPassRate()).isCloseTo(0.5, within(0.0001));
    }

    @Test
    void byUser_agrupaLasCorridasSinUsuarioEnLugarDePerderlas() {
        var nelson = usuario("nrosas", "Nelson Rosas");

        var porUsuario = RunStatsAggregator.byUser(List.of(
                runDe(nelson, proyecto(1L, "ERP"), 1, 0),
                runDe(null, proyecto(1L, "ERP"), 1, 0)));

        assertThat(porUsuario).hasSize(2);
        var huerfanas = porUsuario.stream().filter(u -> u.getUsername() == null).findFirst().orElseThrow();
        assertThat(huerfanas.getFullName()).isNull();
        assertThat(huerfanas.getRuns()).isEqualTo(1);
        // La suma por usuario tiene que cerrar con el total general.
        assertThat(porUsuario.stream().mapToLong(u -> u.getRuns()).sum()).isEqualTo(2);
    }

    @Test
    void byUser_ordenaPorCantidadYDesempataAlfabeticamente() {
        var ana = usuario("aperez", "Ana Pérez");
        var beto = usuario("bgomez", "Beto Gómez");

        var porUsuario = RunStatsAggregator.byUser(List.of(
                runDe(beto, proyecto(1L, "ERP"), 1, 0),
                runDe(ana, proyecto(1L, "ERP"), 1, 0)));

        assertThat(porUsuario).extracting(u -> u.getUsername()).containsExactly("aperez", "bgomez");
    }

    @Test
    void byProject_agrupaPorProyectoIgnorandoLasDescartadas() {
        var descartada = runDe(null, proyecto(2L, "Medical"), 0, 10);
        descartada.setDiscardedByQa(true);

        var porProyecto = RunStatsAggregator.byProject(List.of(
                runDe(null, proyecto(1L, "ERP"), 8, 2),
                runDe(null, proyecto(1L, "ERP"), 10, 0),
                descartada));

        assertThat(porProyecto).hasSize(1);
        assertThat(porProyecto.get(0).getProjectId()).isEqualTo(1L);
        assertThat(porProyecto.get(0).getName()).isEqualTo("ERP");
        assertThat(porProyecto.get(0).getRuns()).isEqualTo(2);
        assertThat(porProyecto.get(0).getPassRate()).isCloseTo(0.9, within(0.0001));
    }
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test -Dtest=RunStatsAggregatorTest`
Expected: FALLA al compilar, con `cannot find symbol: method byUser(...)`.

- [ ] **Step 3: Implementar los dos agrupadores**

Agregar a `RunStatsAggregator`:

```java
    /**
     * Agrupa por usuario. Las corridas sin usuario caen en un grupo con
     * username y fullName nulos en vez de desaparecer: si se perdieran, la suma
     * de este bloque no cerraría con general.totalRuns.
     */
    public static List<StatsByUser> byUser(List<TestRun> runs) {
        Map<String, List<TestRun>> porClave = new LinkedHashMap<>();
        for (TestRun r : vigentes(runs)) {
            String clave = r.getUser() == null ? null : r.getUser().getUsername();
            porClave.computeIfAbsent(clave, k -> new ArrayList<>()).add(r);
        }

        return porClave.values().stream()
                .map(grupo -> {
                    User usuario = grupo.get(0).getUser();
                    return StatsByUser.builder()
                            .username(usuario == null ? null : usuario.getUsername())
                            .fullName(usuario == null ? null : usuario.getFullName())
                            .runs(grupo.size())
                            .passRate(tasaDe(grupo))
                            .build();
                })
                .sorted(Comparator.comparingLong(StatsByUser::getRuns).reversed()
                        .thenComparing(u -> u.getUsername() == null ? "" : u.getUsername()))
                .toList();
    }

    public static List<StatsByProject> byProject(List<TestRun> runs) {
        Map<Long, List<TestRun>> porProyecto = new LinkedHashMap<>();
        for (TestRun r : vigentes(runs)) {
            porProyecto.computeIfAbsent(r.getProject().getId(), k -> new ArrayList<>()).add(r);
        }

        return porProyecto.values().stream()
                .map(grupo -> StatsByProject.builder()
                        .projectId(grupo.get(0).getProject().getId())
                        .name(grupo.get(0).getProject().getName())
                        .runs(grupo.size())
                        .passRate(tasaDe(grupo))
                        .build())
                .sorted(Comparator.comparingLong(StatsByProject::getRuns).reversed()
                        .thenComparing(p -> p.getName() == null ? "" : p.getName()))
                .toList();
    }

    /** Tasa de éxito de un grupo ya filtrado de descartadas. */
    static Double tasaDe(List<TestRun> grupo) {
        return passRate(
                grupo.stream().mapToLong(r -> n(r.getPassed())).sum(),
                grupo.stream().mapToLong(r -> n(r.getFailed())).sum());
    }
```

Agregar los imports que faltan:

```java
import com.royalnet.qareports.dto.Dtos.StatsByProject;
import com.royalnet.qareports.dto.Dtos.StatsByUser;
import com.royalnet.qareports.entity.User;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Map;
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test -Dtest=RunStatsAggregatorTest`
Expected: PASA, 10 tests.

- [ ] **Step 5: Correr la suite completa**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test`
Expected: 55/55.

- [ ] **Step 6: Commit**

```bash
git add src/main/java/com/royalnet/qareports/service/RunStatsAggregator.java src/test/java/com/royalnet/qareports/service/RunStatsAggregatorTest.java
git commit -m "feat(metricas): agregación por analista y por proyecto"
```

---

### Task 5: El bloque `trend`

**Files:**
- Modify: `src/main/java/com/royalnet/qareports/service/RunStatsAggregator.java`
- Test: `src/test/java/com/royalnet/qareports/service/RunStatsAggregatorTest.java`

**Interfaces:**
- Consumes: `vigentes`, `passRate`, `n`, `tasaDe` de las tareas 3-4; `Dtos.StatsTrendPoint` de la Task 1.
- Produces, para la Task 6: `static List<StatsTrendPoint> trend(List<TestRun> runs, LocalDate hoy)` y la constante `public static final int SEMANAS_TENDENCIA = 12`.

**Contexto:** `hoy` se recibe por parámetro y no se lee de `LocalDate.now()` adentro. Es lo que vuelve testeable la ventana: un test que dependiera del reloj real pasaría hoy y fallaría en enero. La semana se identifica por su lunes, con `TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)`. Se agrupa por `startedAt` —cuándo se ejecutó— y no por `receivedAt`, para que una corrida reportada tarde caiga en su semana real; pero `startedAt` es anulable, así que cuando falta se usa `receivedAt`, que siempre existe porque lo pone el servidor.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `RunStatsAggregatorTest`:

```java
    static TestRun runEn(java.time.LocalDateTime iniciada, int passed, int failed) {
        TestRun r = run(passed, failed, 0, 1000L);
        r.setStartedAt(iniciada);
        return r;
    }

    @Test
    void trend_devuelveSiempreDoceSemanasDeLaMasViejaALaMasNueva() {
        var tendencia = RunStatsAggregator.trend(List.of(), java.time.LocalDate.of(2026, 7, 31));

        assertThat(tendencia).hasSize(12);
        assertThat(tendencia.get(0).getWeekStart()).isBefore(tendencia.get(11).getWeekStart());
        // 31/7/2026 es viernes: su semana empieza el lunes 27.
        assertThat(tendencia.get(11).getWeekStart()).isEqualTo(java.time.LocalDate.of(2026, 7, 27));
    }

    @Test
    void trend_laSemanaSinCorridasVaEnCeroYConTasaNula() {
        // Una sola corrida, en la semana en curso: las 11 anteriores quedan vacías.
        var tendencia = RunStatsAggregator.trend(
                List.of(runEn(java.time.LocalDateTime.of(2026, 7, 29, 10, 0), 9, 1)),
                java.time.LocalDate.of(2026, 7, 31));

        assertThat(tendencia.get(11).getRuns()).isEqualTo(1);
        assertThat(tendencia.get(11).getPassRate()).isCloseTo(0.9, within(0.0001));
        assertThat(tendencia.get(10).getRuns()).isZero();
        assertThat(tendencia.get(10).getPassRate()).isNull();
    }

    @Test
    void trend_dejaFueraLasCorridasAnterioresALaVentana() {
        var vieja = runEn(java.time.LocalDateTime.of(2026, 1, 5, 10, 0), 10, 0);

        var tendencia = RunStatsAggregator.trend(List.of(vieja), java.time.LocalDate.of(2026, 7, 31));

        assertThat(tendencia.stream().mapToLong(p -> p.getRuns()).sum()).isZero();
    }

    @Test
    void trend_usaReceivedAtCuandoLaCorridaNoTraeStartedAt() {
        TestRun sinInicio = run(5, 5, 0, 1000L);
        sinInicio.setStartedAt(null);
        sinInicio.setReceivedAt(java.time.LocalDateTime.of(2026, 7, 29, 10, 0));

        var tendencia = RunStatsAggregator.trend(List.of(sinInicio), java.time.LocalDate.of(2026, 7, 31));

        assertThat(tendencia.get(11).getRuns()).isEqualTo(1);
    }
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test -Dtest=RunStatsAggregatorTest`
Expected: FALLA al compilar, con `cannot find symbol: method trend(...)`.

- [ ] **Step 3: Implementar la tendencia**

Agregar a `RunStatsAggregator`:

```java
    public static final int SEMANAS_TENDENCIA = 12;

    /**
     * Tasa de éxito y volumen por semana, hacia atrás desde `hoy`.
     *
     * `hoy` entra por parámetro y no sale de LocalDate.now() para que la ventana
     * sea testeable: un test atado al reloj real pasa hoy y falla en enero.
     *
     * Las semanas sin corridas se devuelven igual, en cero y con tasa nula. Si se
     * omitieran, el gráfico uniría dos puntos lejanos con una recta e inventaría
     * una tendencia que nadie midió.
     */
    public static List<StatsTrendPoint> trend(List<TestRun> runs, LocalDate hoy) {
        LocalDate semanaActual = hoy.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate primeraSemana = semanaActual.minusWeeks(SEMANAS_TENDENCIA - 1L);

        Map<LocalDate, List<TestRun>> porSemana = new HashMap<>();
        for (TestRun r : vigentes(runs)) {
            LocalDateTime cuando = r.getStartedAt() != null ? r.getStartedAt() : r.getReceivedAt();
            if (cuando == null) continue;
            LocalDate semana = cuando.toLocalDate().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            if (semana.isBefore(primeraSemana) || semana.isAfter(semanaActual)) continue;
            porSemana.computeIfAbsent(semana, k -> new ArrayList<>()).add(r);
        }

        List<StatsTrendPoint> puntos = new ArrayList<>(SEMANAS_TENDENCIA);
        for (int i = 0; i < SEMANAS_TENDENCIA; i++) {
            LocalDate semana = primeraSemana.plusWeeks(i);
            List<TestRun> grupo = porSemana.getOrDefault(semana, List.of());
            puntos.add(StatsTrendPoint.builder()
                    .weekStart(semana)
                    .runs(grupo.size())
                    .passRate(grupo.isEmpty() ? null : tasaDe(grupo))
                    .build());
        }
        return puntos;
    }
```

Agregar los imports que faltan:

```java
import com.royalnet.qareports.dto.Dtos.StatsTrendPoint;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.HashMap;
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test -Dtest=RunStatsAggregatorTest`
Expected: PASA, 14 tests.

- [ ] **Step 5: Correr la suite completa**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test`
Expected: 59/59.

- [ ] **Step 6: Commit**

```bash
git add src/main/java/com/royalnet/qareports/service/RunStatsAggregator.java src/test/java/com/royalnet/qareports/service/RunStatsAggregatorTest.java
git commit -m "feat(metricas): tendencia semanal de las últimas doce semanas"
```

---

### Task 6: El servicio y el endpoint

**Files:**
- Create: `src/main/java/com/royalnet/qareports/service/RunStatsService.java`
- Modify: `src/main/java/com/royalnet/qareports/controller/RunController.java`
- Test: `src/test/java/com/royalnet/qareports/controller/RunStatsControllerTest.java` (crear)

**Interfaces:**
- Consumes: `findAllWithProjectAndUser()` (Task 2) y `general` / `byUser` / `byProject` / `trend` (tareas 3-5).
- Produces: `GET /api/runs/stats`, el endpoint que consume el frontend en la Task 7.

**Contexto:** `RunController` ya tiene `@PreAuthorize("hasRole('QA_LEAD')")` **a nivel de clase**, así que el método nuevo hereda la restricción sin anotarlo. El test la verifica igual: la autorización hay que probarla aunque "salga sola", porque el día que alguien mueva esa anotación nadie se va a acordar de que tres endpoints dependían de ella.

Sobre el orden de los métodos: Spring resuelve la ruta literal `/stats` con prioridad sobre la variable `/{id}`, así que **no hay riesgo de que `/stats` se interprete como un id**. Se declara antes que `getRun` igual, por claridad de lectura.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/test/java/com/royalnet/qareports/controller/RunStatsControllerTest.java`:

```java
package com.royalnet.qareports.controller;

import com.royalnet.qareports.TestSupport;
import com.royalnet.qareports.entity.Project;
import com.royalnet.qareports.entity.TestRun;
import com.royalnet.qareports.repository.ProjectRepository;
import com.royalnet.qareports.repository.TestResultRepository;
import com.royalnet.qareports.repository.TestRunRepository;
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
class RunStatsControllerTest {

    @Autowired private MockMvc mvc;
    @Autowired private ProjectRepository projectRepository;
    @Autowired private TestRunRepository runRepository;
    @Autowired private TestResultRepository resultRepository;

    @BeforeEach
    void sembrar() {
        resultRepository.deleteAll();
        runRepository.deleteAll();

        Project erp = projectRepository.save(Project.builder()
                .name("ERP").repoUrl("https://git/erp-" + System.nanoTime() + ".git").active(true).build());

        runRepository.save(TestRun.builder().project(erp).runId("ok-" + System.nanoTime())
                .total(10).passed(9).failed(1).skipped(0).durationMs(2000L)
                .startedAt(LocalDateTime.now().minusDays(1)).build());

        runRepository.save(TestRun.builder().project(erp).runId("descartada-" + System.nanoTime())
                .total(10).passed(0).failed(10).skipped(0).durationMs(2000L)
                .startedAt(LocalDateTime.now().minusDays(1)).discardedByQa(true).build());
    }

    @Test
    @WithMockUser(roles = "QA_LEAD")
    void devuelveLosCuatroBloquesSinContarLasDescartadas() throws Exception {
        mvc.perform(get("/api/runs/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.general.totalRuns").value(1))
                .andExpect(jsonPath("$.data.general.passRate").value(0.9))
                .andExpect(jsonPath("$.data.byProject[0].name").value("ERP"))
                .andExpect(jsonPath("$.data.trend.length()").value(12));
    }

    @Test
    @WithMockUser(roles = "QA_ANALYST")
    void unAnalistaNoPuedeVerLasMetricas() throws Exception {
        mvc.perform(get("/api/runs/stats")).andExpect(status().isForbidden());
    }

    @Test
    @WithMockUser(roles = "QA_LEAD")
    void sinCorridasDevuelve200ConLaMismaEstructura() throws Exception {
        runRepository.deleteAll();

        mvc.perform(get("/api/runs/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.general.totalRuns").value(0))
                .andExpect(jsonPath("$.data.general.passRate").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.data.byUser.length()").value(0))
                .andExpect(jsonPath("$.data.trend.length()").value(12));
    }

    @Test
    void sinSesionNoSeAccede() throws Exception {
        mvc.perform(get("/api/runs/stats")).andExpect(status().isUnauthorized());
    }
}
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test -Dtest=RunStatsControllerTest`
Expected: FALLA — el primer test da 404 porque la ruta todavía no existe.

- [ ] **Step 3: Escribir el servicio**

Crear `src/main/java/com/royalnet/qareports/service/RunStatsService.java`:

```java
package com.royalnet.qareports.service;

import com.royalnet.qareports.dto.Dtos.RunStats;
import com.royalnet.qareports.entity.TestRun;
import com.royalnet.qareports.repository.TestRunRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;

/**
 * Métricas agregadas de corridas. Va aparte de RunQueryService porque no
 * comparten nada: uno traduce entidades a DTOs de lectura, éste agrega.
 *
 * La agregación se hace en memoria y no en SQL: con el volumen del piloto la
 * diferencia es nula, y a cambio toda la lógica queda cubierta por tests
 * unitarios sin base de datos (ver RunStatsAggregator).
 */
@Service
@RequiredArgsConstructor
public class RunStatsService {

    private final TestRunRepository runRepository;

    @Transactional(readOnly = true)
    public RunStats stats() {
        List<TestRun> corridas = runRepository.findAllWithProjectAndUser();

        return RunStats.builder()
                .general(RunStatsAggregator.general(corridas))
                .byUser(RunStatsAggregator.byUser(corridas))
                .byProject(RunStatsAggregator.byProject(corridas))
                .trend(RunStatsAggregator.trend(corridas, LocalDate.now()))
                .build();
    }
}
```

- [ ] **Step 4: Agregar el endpoint**

En `src/main/java/com/royalnet/qareports/controller/RunController.java`:

Agregar el campo, debajo del que ya está:

```java
    private final RunStatsService runStatsService;
```

Agregar el método **entre** `listRuns` y `getRun`:

```java
    // GET /api/runs/stats — hereda el @PreAuthorize de la clase.
    @GetMapping("/stats")
    public ResponseEntity<ApiResponse<RunStats>> getStats() {
        return ResponseEntity.ok(ApiResponse.ok(runStatsService.stats()));
    }
```

Agregar los imports:

```java
import com.royalnet.qareports.dto.Dtos.RunStats;
import com.royalnet.qareports.service.RunStatsService;
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test -Dtest=RunStatsControllerTest`
Expected: PASA, 4 tests.

- [ ] **Step 6: Correr la suite completa**

Run: `export JAVA_HOME=~/.jdks/jdk-21.0.12+8 && mvn test`
Expected: 63/63.

- [ ] **Step 7: Commit**

```bash
git add src/main/java/com/royalnet/qareports/service/RunStatsService.java src/main/java/com/royalnet/qareports/controller/RunController.java src/test/java/com/royalnet/qareports/controller/RunStatsControllerTest.java
git commit -m "feat(runs): GET /api/runs/stats con las métricas del panel"
```

- [ ] **Step 8: Avisar que el backend necesita despliegue**

El frontend no puede verificarse contra el backend en producción hasta que este commit esté pusheado y Render haya reconstruido. **El push lo hace el usuario**: avisarle que las tareas 1-6 están listas y esperan su `git push origin main`.

---

### Task 7: La pantalla conectada

**Files:**
- Modify: `src/api/runs.js`
- Rename + rewrite: `src/screens/ReportsTab.jsx` → `src/screens/MetricsTab.jsx`
- Modify: `src/components/Sidebar.jsx:10-15`
- Modify: `src/screens/MainApp.jsx`

**Working directory:** `~/Escritorio/Proyectos /SpringComuTestQa/Frontend_RasiReport`

**Interfaces:**
- Consumes: `GET /api/runs/stats` (Task 6) y `apiFetch` de `src/api/client.js`.
- Produces, para las tareas 8-9: `MetricsTab.jsx` con el `useEffect` de carga ya montado y las variables `stats`, `cargando` y `error` disponibles en el cuerpo del componente.

**Contexto:** `ReportsTab.jsx` está maquetado pero lee `proj` de `useApp()`, que **ya no existe** en el contexto —`AppContext` expone `data`, no `proj`—, así que hoy la pantalla no se renderiza y por eso el build no se queja. Toda referencia a `proj` desaparece en esta tarea. El componente `BigStat` y la barra de distribución se conservan tal cual están: cambia de dónde salen los números, no cómo se ven.

- [ ] **Step 1: Agregar la llamada a la API**

En `src/api/runs.js`, agregar al final:

```js
export function getRunStats() {
  return apiFetch('/api/runs/stats');
}
```

- [ ] **Step 2: Renombrar el archivo conservando el historial**

```bash
git mv src/screens/ReportsTab.jsx src/screens/MetricsTab.jsx
```

`git mv` y no un borrar-y-crear: la maquetación la escribió el usuario y `git log --follow` tiene que seguir mostrando su autoría.

- [ ] **Step 3: Reescribir el cuerpo del componente**

Reemplazar **todo** el contenido de `src/screens/MetricsTab.jsx` por:

```jsx
import { useEffect, useState } from 'react';
import { getRunStats } from '../api/runs.js';
import { C } from '../theme.js';

function BigStat({ label, value, color }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 4, padding: 20, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: color }} />
      <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: -1, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

export function porcentaje(tasa) {
  return tasa == null ? '—' : `${Math.round(tasa * 100)}%`;
}

export function duracion(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function MetricsTab() {
  const [stats, setStats] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError('');
    getRunStats()
      .then(r => { if (vigente) setStats(r); })
      .catch(e => { if (vigente) setError(e.message); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [recarga]);

  if (cargando) {
    return (
      <div style={{ padding: '48px 28px', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
        Calculando métricas…
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
        <button onClick={() => setRecarga(r => r + 1)} style={{ marginTop: 14, padding: '8px 14px', border: `1px solid ${C.borderStrong}`, background: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 12.5 }}>
          Reintentar
        </button>
      </div>
    );
  }

  const g = stats?.general;

  if (!g || g.totalRuns === 0) {
    return (
      <div style={{ padding: '48px 28px', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
        Todavía no llegó ninguna corrida.
        <div style={{ fontSize: 11.5, marginTop: 8 }}>
          Las métricas aparecen cuando un analista guarde su primera ejecución desde RunQA.
        </div>
      </div>
    );
  }

  const ejecutadas = g.passed + g.failed + g.skipped;
  const tramos = [
    { label: 'Exitosas', n: g.passed, color: C.done },
    { label: 'Con fallos', n: g.failed, color: C.repair },
    { label: 'Salteadas', n: g.skipped, color: C.notStarted },
  ];

  return (
    <div style={{ padding: '24px 28px 32px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 4, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Tendencia de las últimas 12 semanas</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Tasa de éxito y volumen de corridas</div>
          {/* El gráfico entra en la Task 8. */}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <BigStat label="Tasa de éxito" value={porcentaje(g.passRate)} color={C.done} />
          <BigStat label="Corridas totales" value={g.totalRuns} color={C.text} />
          <BigStat label="Corridas con fallos" value={g.runsWithFailures} color={C.repair} />
          <BigStat label="Duración promedio" value={duracion(g.avgDurationMs)} color={C.erp} />
        </div>
      </div>

      <div style={{ marginTop: 16, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 4, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Distribución del estado de las pruebas</div>
        <div style={{ marginTop: 14, display: 'flex', height: 28, borderRadius: 6, overflow: 'hidden' }}>
          {tramos.map(t => {
            const pct = ejecutadas ? (t.n / ejecutadas) * 100 : 0;
            if (!t.n) return null;
            return (
              <div key={t.label} title={`${t.label}: ${t.n}`} style={{ width: `${pct}%`, background: t.color, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 11, fontWeight: 600 }}>
                {pct > 8 ? t.n : ''}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 14 }}>
          {tramos.map(t => (
            <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: t.color }} />
              <span style={{ color: C.textMuted }}>{t.label}</span>
              <span style={{ fontWeight: 600 }}>{t.n}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Agregar el ítem de navegación**

En `src/components/Sidebar.jsx`, reemplazar el comentario de dos líneas que empieza con `// Solo Resultados tiene datos reales` junto con el arreglo `navItems` que le sigue, por:

```jsx
  // Resultados y Métricas tienen datos reales. Las demás pestañas se habilitan
  // en las rebanadas siguientes: un panel que mezcla datos reales con el seed
  // es peor que uno chico.
  const navItems = [
    { id: 'results', label: 'Resultados', icon: ICONS.check },
    { id: 'metrics', label: 'Métricas', icon: ICONS.chart },
  ];
```

- [ ] **Step 5: Renderizar la pestaña**

En `src/screens/MainApp.jsx`, agregar el import:

```jsx
import MetricsTab from './MetricsTab.jsx';
```

y reemplazar la línea `{tab === 'results' && <ResultsTab />}` por:

```jsx
          {tab === 'results' && <ResultsTab />}
          {tab === 'metrics' && <MetricsTab />}
```

- [ ] **Step 6: Verificar el build**

Run: `npm run build`
Expected: build limpio. Si aparece un error por `proj`, quedó una referencia al seed en `MetricsTab`.

- [ ] **Step 7: Commit**

```bash
git add src/api/runs.js src/screens/MetricsTab.jsx src/components/Sidebar.jsx src/screens/MainApp.jsx
git commit -m "feat(metricas): pantalla conectada con salud general y distribución"
```

---

### Task 8: El gráfico de tendencia

**Files:**
- Modify: `src/screens/MetricsTab.jsx`

**Interfaces:**
- Consumes: `stats.trend` (Task 6) y el `MetricsTab` de la Task 7.
- Produces: nada que otra tarea consuma.

**REQUERIDO antes de escribir el gráfico:** cargar la skill `dataviz`. Fija el criterio de color, ejes y accesibilidad que este gráfico tiene que respetar; no lo dibujes de memoria.

**Contexto:** SVG inline, sin librerías. Son doce puntos: una dependencia de gráficos para esto sería más código que el gráfico. Las semanas con `passRate: null` **no se conectan con línea** — se dibuja un hueco. Unir dos puntos separados por una semana muerta afirma una evolución que nadie midió.

- [ ] **Step 1: Escribir el componente del gráfico**

Agregar a `src/screens/MetricsTab.jsx`, arriba de `export default function MetricsTab`:

```jsx
const ALTO = 150;
const ANCHO = 520;
const PAD = { arriba: 10, abajo: 26, izq: 34, der: 8 };

/** Etiqueta corta de la semana: "11/5". */
function etiquetaSemana(iso) {
  const [, mes, dia] = iso.split('-');
  return `${Number(dia)}/${Number(mes)}`;
}

function GraficoTendencia({ puntos }) {
  const util = { ancho: ANCHO - PAD.izq - PAD.der, alto: ALTO - PAD.arriba - PAD.abajo };
  const x = i => PAD.izq + (puntos.length === 1 ? util.ancho / 2 : (i * util.ancho) / (puntos.length - 1));
  const y = tasa => PAD.arriba + util.alto - tasa * util.alto;
  const maxCorridas = Math.max(1, ...puntos.map(p => p.runs));

  // Un tramo por cada racha de semanas con datos: los huecos cortan la línea
  // en vez de que la interpole y sugiera una tendencia que nadie midió.
  const tramos = [];
  let actual = [];
  puntos.forEach((p, i) => {
    if (p.passRate == null) {
      if (actual.length) tramos.push(actual);
      actual = [];
    } else {
      actual.push(`${x(i)},${y(p.passRate)}`);
    }
  });
  if (actual.length) tramos.push(actual);

  return (
    <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} width="100%" height={ALTO} role="img"
      aria-label="Tasa de éxito y volumen de corridas por semana, últimas doce semanas">
      {[0, 0.5, 1].map(t => (
        <g key={t}>
          <line x1={PAD.izq} x2={ANCHO - PAD.der} y1={y(t)} y2={y(t)} stroke={C.border} strokeWidth="1" />
          <text x={PAD.izq - 6} y={y(t) + 3.5} textAnchor="end" fontSize="9.5" fill={C.textFaint}>
            {Math.round(t * 100)}%
          </text>
        </g>
      ))}

      {puntos.map((p, i) => {
        const alto = (p.runs / maxCorridas) * util.alto * 0.35;
        return p.runs ? (
          <rect key={`b${i}`} x={x(i) - 5} y={PAD.arriba + util.alto - alto} width="10" height={alto}
            fill={C.erpSoft} />
        ) : null;
      })}

      {tramos.map((tramo, i) => (
        <polyline key={`l${i}`} points={tramo.join(' ')} fill="none" stroke={C.done} strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" />
      ))}

      {puntos.map((p, i) => p.passRate != null && (
        <circle key={`p${i}`} cx={x(i)} cy={y(p.passRate)} r="3" fill={C.done}>
          <title>{`${etiquetaSemana(p.weekStart)}: ${Math.round(p.passRate * 100)}% · ${p.runs} corridas`}</title>
        </circle>
      ))}

      {puntos.map((p, i) => (i % 2 === 0 ? (
        <text key={`x${i}`} x={x(i)} y={ALTO - 8} textAnchor="middle" fontSize="9.5" fill={C.textFaint}>
          {etiquetaSemana(p.weekStart)}
        </text>
      ) : null))}
    </svg>
  );
}
```

- [ ] **Step 2: Montarlo en la pantalla**

En `MetricsTab`, reemplazar la línea `{/* El gráfico entra en la Task 8. */}` por:

```jsx
          <div style={{ marginTop: 14 }}>
            <GraficoTendencia puntos={stats.trend || []} />
          </div>
```

- [ ] **Step 3: Verificar el build**

Run: `npm run build`
Expected: build limpio.

- [ ] **Step 4: Verificar a ojo con datos de prueba**

Con el backend corriendo y al menos una corrida cargada, abrir la pestaña Métricas y confirmar:
- Las semanas sin corridas dejan un hueco en la línea, no un tramo que baja a cero.
- Al pasar el mouse por un punto aparece el porcentaje y la cantidad de corridas.
- Las etiquetas del eje X no se pisan entre sí.

- [ ] **Step 5: Commit**

```bash
git add src/screens/MetricsTab.jsx
git commit -m "feat(metricas): gráfico de tendencia en SVG, con huecos en las semanas vacías"
```

---

### Task 9: Las tablas por analista y por proyecto

**Files:**
- Modify: `src/screens/MetricsTab.jsx`

**Interfaces:**
- Consumes: `stats.byUser` y `stats.byProject` (Task 6).
- Produces: nada que otra tarea consuma. **Cierra el feature.**

**Contexto:** se usa el mismo patrón de grilla que `ResultsTab` —una constante con `gridTemplateColumns`, encabezado en mayúsculas sobre `C.bg`, filas separadas por `borderTop`— para que las pantallas se lean como una familia. El grupo de corridas sin usuario llega con `username` en `null` y se rotula "Sin identificar".

- [ ] **Step 1: Escribir la tabla reutilizable**

Agregar a `src/screens/MetricsTab.jsx`, arriba de `export default function MetricsTab`:

```jsx
const celdasMetrica = '1.6fr 90px 90px';

function TablaMetrica({ titulo, subtitulo, filas }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 14, fontWeight: 650 }}>{titulo}</div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 3 }}>{subtitulo}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: celdasMetrica, padding: '10px 18px', background: C.bg, color: C.textMuted, fontSize: 10.5, fontWeight: 700, letterSpacing: .4, textTransform: 'uppercase' }}>
        <span>Nombre</span><span>Corridas</span><span>Tasa</span>
      </div>
      {filas.length === 0 && (
        <div style={{ padding: '24px 18px', textAlign: 'center', color: C.textMuted, fontSize: 12.5 }}>
          Sin datos todavía.
        </div>
      )}
      {filas.map((f, i) => (
        <div key={f.clave} style={{ display: 'grid', gridTemplateColumns: celdasMetrica, padding: '13px 18px', alignItems: 'center', borderTop: i ? `1px solid ${C.border}` : 'none', fontSize: 12 }}>
          <span style={{ fontWeight: 600 }}>{f.nombre}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{f.runs}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: f.passRate != null && f.passRate < 0.8 ? C.repair : C.text, fontWeight: 600 }}>
            {porcentaje(f.passRate)}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Montar las dos tablas**

En `MetricsTab`, agregar **después** del bloque de "Distribución del estado de las pruebas" y antes del `</div>` que cierra el componente:

```jsx
      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <TablaMetrica
          titulo="Por analista"
          subtitulo="Corridas reportadas desde RunQA"
          filas={(stats.byUser || []).map(u => ({
            clave: u.username || 'sin-identificar',
            nombre: u.fullName || u.username || 'Sin identificar',
            runs: u.runs,
            passRate: u.passRate,
          }))}
        />
        <TablaMetrica
          titulo="Por proyecto"
          subtitulo="Repositorios con corridas recibidas"
          filas={(stats.byProject || []).map(p => ({
            clave: String(p.projectId),
            nombre: p.name,
            runs: p.runs,
            passRate: p.passRate,
          }))}
        />
      </div>
```

- [ ] **Step 3: Verificar el build**

Run: `npm run build`
Expected: build limpio.

- [ ] **Step 4: Verificación de punta a punta**

Requiere el backend desplegado (Task 6 Step 8) y el panel publicado.

1. Correr al menos una prueba desde RunQA y guardarla, para que haya datos.
2. Abrir el panel, entrar como `admin` y pasar a la pestaña **Métricas**.
3. Confirmar que la tasa de éxito de la tarjeta coincide con la que muestra RunQA para esa corrida.
4. Confirmar que la suma de la columna "Corridas" de la tabla por analista es igual a "Corridas totales".
5. Descartar una corrida en RunQA, reportarla y confirmar que **no** mueve ningún número.
6. Entrar con un usuario `QA_ANALYST` y confirmar que el panel lo rechaza en el login.

- [ ] **Step 5: Commit**

```bash
git add src/screens/MetricsTab.jsx
git commit -m "feat(metricas): tablas por analista y por proyecto"
```

- [ ] **Step 6: Avisar al usuario**

El feature está completo en el working tree, con todo commiteado y **nada pusheado**. Avisarle que le quedan dos `git push origin main` —backend y frontend— y que Render reconstruye solo.
