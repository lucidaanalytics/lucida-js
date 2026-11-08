# @lucida-analytics/cli

The `lucida` command line for [Lucida](https://lucidace.com).

```sh
npx @lucida-analytics/cli login --device   # run once without installing
npm i -g @lucida-analytics/cli             # or install a `lucida` command
lucida doctor
```

On first run it downloads the native binary for your platform from the matching
[GitHub release](https://github.com/lucidaanalytics/lucida-cli/releases), checks it against the SHA-256 sums that ship in
this package, and caches it (`~/Library/Caches/lucida/cli` on macOS, `$XDG_CACHE_HOME/lucida/cli` or `~/.cache/lucida/cli`
on Linux, `%LOCALAPPDATA%\lucida\cli` on Windows; set `LUCIDA_CACHE_DIR` to change it). A download that does not match is
never run. Builds exist for macOS, Linux and Windows on x64 and arm64. Needs Node 20.10 or later.

Full guide: <https://lucidace.com/help/install-cli>.
