import frontendPackage from "../frontend/package.json" with { type: "json" };

const dependencies = frontendPackage.dependencies ?? {};
const runtimePackages = ["react", "react-dom"];
const runtimeSpecs = runtimePackages.map((name) => dependencies[name]);

if (runtimeSpecs.some((spec) => !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(spec ?? ""))) {
  throw new Error("React runtime dependencies must use exact versions in frontend/package.json");
}

if (runtimeSpecs[0] !== runtimeSpecs[1]) {
  throw new Error(
    `React runtime specifications must match: react=${runtimeSpecs[0]}, react-dom=${runtimeSpecs[1]}`,
  );
}

const installedPackages = await Promise.all(
  runtimePackages.map(async (name) => {
    const packageUrl = new URL(`../frontend/node_modules/${name}/package.json`, import.meta.url);
    const { default: packageJson } = await import(packageUrl.href, {
      with: { type: "json" },
    });
    return [name, packageJson];
  }),
);
const installedVersions = Object.fromEntries(
  installedPackages.map(([name, packageJson]) => [name, packageJson.version]),
);

if (installedVersions.react !== installedVersions["react-dom"]) {
  throw new Error(
    `Installed React runtime versions must match: react=${installedVersions.react}, react-dom=${installedVersions["react-dom"]}`,
  );
}

if (runtimeSpecs.some((spec, index) => installedVersions[runtimePackages[index]] !== spec)) {
  throw new Error(
    `Installed React runtime versions must match the manifest: react=${installedVersions.react}, react-dom=${installedVersions["react-dom"]}`,
  );
}

process.stdout.write(
  `Dependency invariants passed: react@${installedVersions.react} and react-dom@${installedVersions["react-dom"]}\n`,
);
