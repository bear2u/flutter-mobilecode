import { createInterface } from "node:readline"

const emit = (message) => process.stdout.write(JSON.stringify([message]) + "\n")
emit({ event: "app.start", params: { appId: "test-app" } })
emit({ event: "app.log", params: { log: "fixture ready" } })
emit({ event: "app.started", params: { appId: "test-app" } })
createInterface({ input: process.stdin }).on("line", (line) => {
  const [request] = JSON.parse(line)
  if (request.params.appId !== "test-app") {
    emit({ id: request.id, error: "Wrong app id" })
    return
  }
  emit({ event: "app.log", params: { log: JSON.stringify(request) } })
  if (request.method === "app.stop") {
    emit({ id: request.id, result: true })
    process.exit(0)
  }
  emit({ id: request.id, result: { code: request.params.fullRestart ? 1 : 0, message: "restart rejected" } })
})
