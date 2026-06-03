# Tasks, Processes, Services

Use tasks for finite dependency graphs, processes for custom long-running commands, and services for preconfigured software like databases.

## Tasks

```nix
{
  tasks."myapp:hello" = {
    exec = ''echo "Hello, world!"'';
  };
}
```

Run one task or a namespace:

```bash
devenv tasks run myapp:hello
devenv tasks run myapp
```

## Task Edges

```nix
{
  tasks."myapp:build".after = [ "myapp:generate" ];
  tasks."myapp:generate".before = [ "myapp:build" ];
}
```

- `after = [ "other" ]`: this task runs after dependency `other`.
- `before = [ "other" ]`: this task runs before downstream task `other`.

## Dependency States

| Suffix | Satisfied when | Failure propagates |
|---|---|---|
| `@started` | target begins executing | yes |
| `@ready` | process readiness probe passes; oneshot task succeeds | yes |
| `@succeeded` | target exits with code 0 or is skipped | yes |
| `@completed` | target finishes regardless of exit code | no |

Defaults: processes use `@ready`; oneshot tasks use `@succeeded`.

## Execution Modes

| Mode | Runs |
|---|---|
| `single` | only the named task |
| `before` | task plus upstream dependencies; default |
| `after` | task plus downstream dependents |
| `all` | whole connected graph |

`devenv up` uses `before` mode. `devenv test` uses `all` mode. If setup/configure tasks are downstream of a process, run `devenv up --mode all`.

## Lifecycle Tasks

```nix
{
  tasks."bash:hello" = {
    exec = "echo hello";
    before = [ "devenv:enterShell" ];
  };

  tasks."myapp:test-setup" = {
    exec = "echo fixtures";
    before = [ "devenv:enterTest" ];
  };
}
```

- `devenv:enterShell`: before `devenv shell` and before `devenv up` starts processes.
- `devenv:enterTest`: before `devenv test`; depends on `devenv:enterShell`.

## Task Caching And Inputs

```nix
{
  tasks."myapp:migrations" = {
    exec = "db-migrate";
    status = "db-needs-migrations";
  };

  tasks."myapp:build" = {
    exec = "npm run build";
    execIfModified = [ "src/**/*.ts" "package.json" ];
    cwd = "./frontend";
  };
}
```

- `status`: skip `exec` when status command exits 0.
- `execIfModified`: run only when watched files changed.
- `$DEVENV_TASK_INPUT`, `$DEVENV_TASKS_OUTPUTS`, `$DEVENV_TASK_OUTPUT_FILE`, `$DEVENV_TASK_EXPORTS_FILE`: pass JSON outputs and env exports between tasks.

## Processes

```nix
{
  processes = {
    server = {
      exec = "python -m http.server";
      cwd = "./public";
    };
  };
}
```

Start/stop/wait:

```bash
devenv up
devenv up -d
devenv processes wait --timeout 120
devenv down
```

## Process Dependencies And Readiness

```nix
{
  processes.database = {
    exec = "postgres -D $PGDATA";
    ready.exec = "pg_isready -d template1";
  };

  processes.api = {
    exec = "myapi";
    after = [ "devenv:processes:database" ];
    ready.http.get = {
      port = 8080;
      path = "/health";
    };
  };
}
```

Ready probes can be `exec`, `http.get`, or `notify`. When `listen` sockets or allocated `ports` exist and no explicit probe exists, devenv uses a TCP connectivity check.

## Process Watch And Ports

```nix
{ config, ... }:

{
  processes.backend = {
    exec = "cargo run";
    watch = {
      paths = [ ./src ];
      extensions = [ "rs" "toml" ];
      ignore = [ "target" "*.log" ];
    };
  };

  processes.server = {
    ports.http.allocate = 8080;
    exec = "python -m http.server ${toString config.processes.server.ports.http.value}";
  };
}
```

`watch.paths` resolve relative to `devenv.nix`, not process `cwd`. Use `strict_ports: true` or `devenv up --strict-ports` when auto-incremented ports are unacceptable.

## Processes As Tasks

Every process is available as `devenv:processes:<name>`.

```nix
{
  processes.web-server.exec = "python -m http.server 8080";

  tasks."app:setup-data" = {
    exec = "echo setup";
    before = [ "devenv:processes:web-server" ];
  };
}
```

Use `@completed` for cleanup after a process exits.

## Services

Services are preconfigured processes.

```nix
{ pkgs, ... }:

{
  services.postgres = {
    enable = true;
    package = pkgs.postgresql_15;
    initialDatabases = [{ name = "mydb"; }];
  };
}
```

Start with `devenv up`. Start detached with `devenv up -d`.

Service state persists under `$DEVENV_STATE`; changes to first-init settings often require deleting that service's state directory before the next `devenv up`.

## Service Categories

| Category | Services |
|---|---|
| Datastores | `postgres`, `mysql`, `mongodb`, `redis`, `cockroachdb`, `cassandra`, `clickhouse`, `couchdb`, `dynamodb-local`, `sqld`, `memcached`, `influxdb` |
| Messaging | `nats`, `rabbitmq`, `kafka`, `mosquitto`, `elasticmq` |
| Object storage | `minio`, `garage`, `rustfs` |
| Search/observability | `opensearch`, `elasticsearch`, `meilisearch`, `typesense`, `prometheus`, `opentelemetry-collector` |
| Web/proxy/test | `nginx`, `caddy`, `varnish`, `trafficserver`, `httpbin`, `wiremock`, `adminer`, `mailhog`, `mailpit` |
| Infra/security | `vault`, `keycloak`, `tailscale`, `temporal`, `blackfire`, `tideways`, `nixseparatedebuginfod` |

Search exact service options before configuring: `devenv search services.<name>` or generated option headings like `## services.postgres.enable`.
