# The engine's API

The engine is a small HTTP server on this machine: the app talks to it, and so do the workbench's scripts. You can
call it too, from a terminal, R or Python, while the app is running: it is how to drive the worker pool from
outside. In the desktop app it listens on `127.0.0.1` at port 3040 or the next free one (the engine's log says
which); from source, at 3040.

!!! warning "This machine only"
    The engine answers only requests addressed to this machine's loopback names (`localhost`, `127.0.0.1`,
    `[::1]`), for the page as well as the API: any other host name gets `421`. It accepts cross-origin requests only
    from pages on this machine, and a `POST` or `PUT` to the API only with the media type `application/json`
    (anything else, `text/plain` included, gets `415`). It has no password: anything running on this machine can
    call it.

## Health

```bash
curl -s http://127.0.0.1:3040/api/health
# {"ok":true,"app":"community-lab","edition":"ide","exchange":1,"time":…,"version":"1.0.0"}
```

## Jobs on the worker pool

| Method and path | What it does |
|---|---|
| `POST /api/experiments` | Start a paired experiment. The body is an [experiment spec](../workbench/experiment-files.md) (`$schema` and `notes` left out). Returns the job: `id`, `status`, `done`, `total`, `warnings`. |
| `GET /api/experiments/:id` | The job, and its `result` when it is done. |
| `DELETE /api/experiments/:id` | Cancel a job (any job, by its id). |
| `GET /api/experiments` | Jobs running, and the last fifty experiments kept. |
| `GET /api/experiments/:id/export` | A finished experiment as an [exchange](../exports/exchange.md) export. |
| `POST /api/exports` | Pooled mortality experience: `{ "kind": "experience", "seeds": 16, "years": 10, "ageWidth": 5, "group": "none", "base": {…}, "mortality": {…}, "shocks": […] }`. At most 64 seeds, 40 years and 800 province-years. |
| `GET /api/exports/:id` | The job, and its `export` when it is done. |
| `POST /api/batch` | A Monte Carlo run: `{ "params": {…}, "seeds": 20, "years": 30 }` (1 to 200 seeds, 1 to 60 years; 20 seeds and 30 years when not given). `params` are the engine's scenario parameters by name; a world from the builder goes in `params.plan`. |
| `GET /api/batch` | The last fifty Monte Carlo runs kept, a built world named rather than included. |
| `GET /api/batch/:id`, `GET /api/batch/:id/csv` | Its progress and summary; its runs as CSV. |
| `GET /api/exchange` | The format's version, the indicators, the templates and the worker pool's size and load. |
| `GET /api/templates/:id?years=10` | One of the lab's templates as a spec. |

An experiment or a pooled export runs in the built-in province unless its body carries a `world`: a world built in
the [Community Builder](../builder/index.md), as its `.sce` file's JSON or the bare world inside it. A world that
cannot run yet is refused with `400` and the first of its checks' errors. The result's provenance then names the
world.

Poll a job's `GET` until its `status` is `done` (or `error`, or `cancelled`; a cancelled Monte Carlo run reads
`error`); `done` and `total` count runs.

=== "curl"

    ```bash
    curl -s http://127.0.0.1:3040/api/exports -H 'content-type: application/json' \
      -d '{"kind":"experience","seeds":16,"years":10,"ageWidth":5}'
    # {"id":"e…","kind":"export","status":"running","done":0,"total":16,…}
    curl -s http://127.0.0.1:3040/api/exports/e…    # poll until "status":"done"
    ```

=== "Python"

    ```python
    import time, requests
    api = "http://127.0.0.1:3040"
    job = requests.post(f"{api}/api/exports", json={"kind": "experience", "seeds": 16, "years": 10}).json()
    while (r := requests.get(f"{api}/api/exports/{job['id']}").json())["status"] == "running":
        time.sleep(5)
    rows = r["export"]["tables"][0]["rows"]
    ```

=== "R"

    ```r
    library(httr2)
    api <- "http://127.0.0.1:3040"
    job <- request(paste0(api, "/api/exports")) |>
      req_body_json(list(kind = "experience", seeds = 16, years = 10)) |> req_perform() |> resp_body_json()
    repeat {
      r <- request(paste0(api, "/api/exports/", job$id)) |> req_perform() |> resp_body_json()
      if (r$status != "running") break
      Sys.sleep(5)
    }
    ```

## Saved worlds

The worlds in the `worlds` folder of the lab's data (see [Files and environment](files.md)), a `.sce` file each:

| Method and path | What it does |
|---|---|
| `GET /api/plans` | The saved worlds, newest first (at most 200), each with its `id`, `name`, `file`, `updated_at`, `bytes` and a few counts (buildings, houses, cities, settlements, errors, where it began). |
| `GET /api/plans/:id` | One world, as the bare world. |
| `PUT /api/plans/:id` | Save a world: the body is its `.sce` JSON or the bare world, sent as `application/json`; its `id` (letters, digits, `_` and `-`, at most 80) must match the address. Saving a world again replaces its file, under its new name if it was renamed. |
| `DELETE /api/plans/:id` | Delete a saved world's file. |

## The workspace

The workbench's file operations, confined to the open workspace (paths are relative to it; `..`, absolute paths and
links that lead out are refused):

| Method and path | What it does |
|---|---|
| `GET /api/workspace` | The open folder, its file tree, the recent folders. |
| `POST /api/workspace/open`, `/close`, `/create` | Open a folder (`{ "root": "/full/path" }`, which may start with `~`), close it, or create one (`{ "parent", "name", "sample" }`: in Documents as `Community Lab` unless told otherwise, with the sample unless `"sample": false`). |
| `GET /api/workspace/file?path=…` | A file's text and its modification time. |
| `PUT /api/workspace/file` | Write a file (`{ "path", "text", "mtime" }`); with the `mtime` it read, a file changed since is refused with `409`. |
| `POST /api/workspace/mkdir`, `/rename`, `/delete` | Make a folder, rename (`{ "from", "to" }`), or move to the engine's trash (`data/trash/`). The desktop app's explorer uses the system's trash instead. |

## Dialogue

| Method and path | What it does |
|---|---|
| `GET /api/providers`, `POST /api/providers` | Which language-model providers are available (never the keys themselves); set keys and preferences. |
| `POST /api/dialogue` | Stream a reply as server-sent events. |
| `DELETE /api/cache` | Clear the dialogue cache. |
