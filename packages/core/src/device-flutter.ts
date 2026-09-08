export * as DeviceFlutter from "./device-flutter"

import launch from "cross-spawn"
import { createInterface } from "node:readline"

type Message = {
  id?: number
  event?: string
  params?: Record<string, unknown>
  result?: { code?: number; message?: string }
  error?: unknown
}

/** Flutter's documented machine protocol keeps debug sessions alive for reload and restart. */
export function run(input: {
  directory: string
  device: string
  env?: Record<string, string>
  log: (line: string) => void
  started: () => void
  progress: (message: string) => void
}) {
  const child = launch("flutter", ["run", "--machine", "-d", input.device], {
    cwd: input.directory,
    env: { ...process.env, ...input.env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  let appID: string | undefined
  let sequence = 0
  const pending = new Map<number, (error?: string) => void>()
  const receive = (line: string) => {
    let messages: Message[]
    try {
      const value: unknown = JSON.parse(line)
      if (!Array.isArray(value)) return input.log(line)
      messages = value
    } catch {
      input.log(line)
      return
    }
    for (const message of messages) {
      if (!message || typeof message !== "object") continue
      if (typeof message.id === "number") {
        pending.get(message.id)?.(
          message.error
            ? JSON.stringify(message.error)
            : message.result?.code
              ? (message.result.message ?? "Flutter restart failed")
              : undefined,
        )
        continue
      }
      const params = message.params ?? {}
      if (message.event === "app.start" && typeof params.appId === "string") appID = params.appId
      if (message.event === "app.started") input.started()
      if (message.event === "app.progress" && typeof params.message === "string") input.progress(params.message)
      if (typeof params.log === "string") input.log(params.log)
      if (message.event === "daemon.logMessage" && typeof params.message === "string") input.log(params.message)
    }
  }
  if (child.stdout) createInterface({ input: child.stdout }).on("line", receive)
  if (child.stderr) createInterface({ input: child.stderr }).on("line", input.log)
  const exit = new Promise<number>((resolve) => {
    const finish = (code: number) => {
      for (const complete of pending.values()) complete("Flutter process exited")
      resolve(code)
    }
    child.once("error", (error) => {
      input.log(error.message)
      finish(-1)
    })
    child.once("close", (code) => finish(code ?? -1))
  })
  const request = (method: string, params: Record<string, unknown>) =>
    new Promise<void>((resolve, reject) => {
      if (!appID || !child.stdin?.writable || child.exitCode !== null)
        return reject(new Error("Flutter app is not running. Press Play first."))
      const id = ++sequence
      const timer = setTimeout(() => complete("Flutter command timed out"), 60_000)
      const complete = (error?: string) => {
        clearTimeout(timer)
        pending.delete(id)
        if (error) reject(new Error(error))
        else resolve()
      }
      pending.set(id, complete)
      child.stdin.write(JSON.stringify([{ id, method, params: { appId: appID, ...params } }]) + "\n", (error) => {
        if (error) complete(error.message)
      })
    })
  return {
    child,
    exit,
    restart: (fullRestart: boolean) => request("app.restart", { fullRestart, pause: false, reason: "manual" }),
    stop: () => request("app.stop", {}),
  }
}
