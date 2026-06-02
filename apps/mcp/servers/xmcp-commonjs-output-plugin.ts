const PLUGIN_NAME = "CmdclawXmcpCommonJsOutputPlugin";

export function addCommonJsPackageBoundary(config: any) {
  const plugin = {
    apply(compiler: any) {
      compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation: any) => {
        const stage = compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL;
        compilation.hooks.processAssets.tap({ name: PLUGIN_NAME, stage }, () => {
          compilation.emitAsset(
            "package.json",
            new compiler.webpack.sources.RawSource('{"type":"commonjs"}\n'),
          );
        });
      });
    },
  };

  config.plugins = [...(config.plugins ?? []), plugin];
  return config;
}
