import { expect, test } from "bun:test"
import path from "node:path"
import { DeviceBuild } from "../src/device-build"
import { tmpdir } from "./fixture/tmpdir"
import { chmod } from "node:fs/promises"
import { DeviceFlutter } from "../src/device-flutter"

test("Flutter root takes precedence over generated native projects", async () => {
  await using tmp = await tmpdir()
  await Bun.write(
    path.join(tmp.path, "app/pubspec.yaml"),
    "name: example\ndependencies:\n  flutter:\n    sdk: flutter\n",
  )
  await Bun.write(path.join(tmp.path, "app/android/settings.gradle"), "include ':app'")
  await Bun.write(path.join(tmp.path, "app/ios/Runner.xcodeproj/project.pbxproj"), "")
  const projects = DeviceBuild.findProjects(tmp.path)
  expect(projects.length).toBe(process.platform === "darwin" ? 2 : 1)
  for (const project of projects) {
    expect(project.framework).toBe("flutter")
    expect(project.root).toBe(path.join(tmp.path, "app"))
    expect(project.directory).toBe(project.root)
    expect(project.needsPrebuild).toBe(false)
  }
})

test("Dart-only package and malformed YAML are not Flutter projects", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "pubspec.yaml"), "name: dart_only\n")
  expect(DeviceBuild.findProjects(tmp.path)).toEqual([])
  await Bun.write(path.join(tmp.path, "pubspec.yaml"), "dependencies: [broken")
  expect(DeviceBuild.findProjects(tmp.path)).toEqual([])
})

test("Flutter detection accepts inline YAML and only enabled mobile platforms", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "pubspec.yaml"), "dependencies: {flutter: {sdk: flutter}}")
  await Bun.write(path.join(tmp.path, "android/settings.gradle"), "")
  expect(DeviceBuild.findProjects(tmp.path).map((project) => [project.platform, project.framework])).toEqual([
    ["android", "flutter"],
  ])
})

test("machine session handles start, reload acknowledgement, restart failure and stop", async () => {
  await using tmp = await tmpdir()
  const fixture = path.join(import.meta.dir, "fixture/flutter-machine.mjs")
  await Bun.write(path.join(tmp.path, "flutter"), `#!/bin/sh\nexec '${process.execPath}' '${fixture}'\n`)
  await chmod(path.join(tmp.path, "flutter"), 0o755)
  const logs: string[] = []
  const ready = Promise.withResolvers<void>()
  const session = DeviceFlutter.run({
    directory: tmp.path,
    device: "test-device",
    env: { PATH: `${tmp.path}:${process.env.PATH}` },
    log: (line) => logs.push(line),
    started: ready.resolve,
    progress: () => {},
  })
  try {
    await ready.promise
    await session.restart(false)
    await expect(session.restart(true)).rejects.toThrow("restart rejected")
    expect(logs).toContain("fixture ready")
    expect(logs.some((line) => line.includes('"fullRestart":false'))).toBe(true)
    await session.stop()
    expect(await session.exit).toBe(0)
    await expect(session.restart(false)).rejects.toThrow("not running")
  } finally {
    session.child.kill()
    await session.exit
  }
})
