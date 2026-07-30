export function parseRuntimeOptions(argv = process.argv) {
  const vkNextArgument = argv.find((argument) => argument.startsWith('--vk-next='));
  const vkNextValue = vkNextArgument?.slice('--vk-next='.length);
  const outputArgument = argv.find((argument) => argument.startsWith('--benchmark-output='));

  return {
    benchmark: argv.includes('--benchmark'),
    benchmarkOutput: outputArgument?.slice('--benchmark-output='.length) || null,
    safeGraphics: argv.includes('--safe-graphics'),
    vkNextOverride: vkNextValue === 'on' ? true : vkNextValue === 'off' ? false : null
  };
}
