#!/usr/bin/env bash
# judgineer インストーラー
#
#   curl -fsSL https://raw.githubusercontent.com/jphacks/tka_2607/main/install.sh | bash
#
# GitHub Releases から、この OS 向けの最新の judgineer (単体バイナリ) を ~/.judgineer/bin に置き、
# `judgineer` コマンドを使えるようにする。Linux / macOS / Windows (Git Bash) に対応。
#
# 環境変数:
#   JUDGINEER_HOME          インストール先 (既定 ~/.judgineer)。絶対パスで指定する
#   JUDGINEER_REPO          取得元リポジトリ (既定 jphacks/tka_2607)
#   JUDGINEER_RELEASES_URL  リリース一覧 API の URL (テスト用)
#   GITHUB_TOKEN            API の回数制限 (未認証は 1 時間 60 回) に当たるとき用
set -euo pipefail

REPO="${JUDGINEER_REPO:-jphacks/tka_2607}"
INSTALL_HOME="${JUDGINEER_HOME:-$HOME/.judgineer}"
case "$INSTALL_HOME" in
  /* | [A-Za-z]:[/\\]*) ;;
  *)
    echo "エラー: JUDGINEER_HOME は絶対パスで指定してください" >&2
    exit 1
    ;;
esac
# 最新から数えて、この件数までさかのぼってバイナリを探す
MAX_RELEASES=5
RELEASES_URL="${JUDGINEER_RELEASES_URL:-https://api.github.com/repos/$REPO/releases?per_page=$MAX_RELEASES}"
RC_BEGIN="# >>> judgineer >>>"
RC_END="# <<< judgineer <<<"

info() { printf '%s\n' "$*"; }
warn() { printf '警告: %s\n' "$*" >&2; }
die() {
  printf 'エラー: %s\n' "$*" >&2
  exit 1
}

TMP=""
cleanup() { [ -z "$TMP" ] || rm -rf "$TMP"; }
trap cleanup EXIT
trap 'exit 130' INT TERM

need() { command -v "$1" >/dev/null 2>&1 || die "$1 が必要です。インストールしてからやり直してください"; }

# release.yml のビルド対象に合わせる (TARGET と、実行ファイルの拡張子 EXT を決める)
detect_target() {
  local os arch
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    MINGW* | MSYS* | CYGWIN*) os=windows ;;
    *) die "未対応の OS です: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) die "未対応の CPU です: $(uname -m)" ;;
  esac
  # Rosetta 下のシェルは x86_64 を名乗るので、実機が Apple Silicon なら arm64 を選ぶ
  if [ "$os-$arch" = "darwin-x64" ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then
    arch=arm64
  fi
  TARGET="$os-$arch"
  EXT=""
  case "$TARGET" in
    linux-x64 | linux-arm64 | darwin-x64 | darwin-arm64) ;;
    windows-x64) EXT=".exe" ;;
    *) die "この環境向けのバイナリはありません: $TARGET" ;;
  esac
  if [ "$os" = linux ] && { ldd --version 2>&1 || true; } | grep -qi musl; then
    die "musl (Alpine など) 向けのバイナリはありません。glibc の環境で実行してください"
  fi
}

fetch() { # fetch URL [OUT]
  local auth=()
  if [ -n "${GITHUB_TOKEN:-}" ] && [[ "$1" == https://api.github.com/* ]]; then
    auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  fi
  if [ $# -ge 2 ]; then
    curl -fsSL --retry 3 --connect-timeout 15 ${auth[@]+"${auth[@]}"} -o "$2" "$1"
  else
    curl -fsSL --retry 3 --connect-timeout 15 ${auth[@]+"${auth[@]}"} \
      -H "Accept: application/vnd.github+json" "$1"
  fi
}

# 新しい順に「タグ<TAB>バイナリURL<TAB>SHA256SUMS の URL(無ければ空)」を出力する。
# バイナリは release.yml がリリース公開の後でアップロードするので、ビルド中のリリースには無い。
# 自分の環境向けのバイナリと SHA256SUMS がそろったものだけを候補にする
list_candidates() {
  local json urls url base
  json=$(fetch "$RELEASES_URL") ||
    die "リリース一覧を取得できません (ネットワーク、または API の回数制限。GITHUB_TOKEN を設定すると緩和されます)"
  urls=$(printf '%s' "$json" |
    grep -o '"browser_download_url": *"[^"]*"' |
    sed 's/^[^:]*: *"\(.*\)"$/\1/') || true
  while IFS= read -r url; do
    case "$url" in
      */judgineer-"$TARGET$EXT")
        base="${url%/*}"
        # SHA256SUMS が無いリリースは、検証できないので候補にしない
        if printf '%s\n' "$urls" | grep -Fxq "$base/SHA256SUMS"; then
          printf '%s\t%s\t%s\n' "${base##*/}" "$url" "$base/SHA256SUMS"
        fi
        ;;
    esac
  done <<<"$urls"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# 1 件ぶんを TMP/judgineer に用意する。失敗したら 1 を返し、次の候補へ回す
stage_release() { # stage_release URL SUMS_URL
  local out="$TMP/judgineer$EXT" want
  rm -f "$out"
  fetch "$1" "$out" || return 1
  # HTML のエラーページなどを実行ファイルとして置かないための最低限の確認 (本体は数十 MB)
  [ "$(wc -c <"$out")" -gt 10000000 ] || return 1
  fetch "$2" "$TMP/SHA256SUMS" || return 1
  want=$(awk -v n="${1##*/}" '$2 == n || $2 == "*" n { print $1; exit }' "$TMP/SHA256SUMS")
  [ -n "$want" ] && [ "$(sha256_of "$out")" = "$want" ] || return 1
  chmod +x "$out"
  # 動くことを確かめる (CPU や libc が合わない場合はここで分かる)
  "$out" version >/dev/null 2>&1 || return 1
}

# シェルの rc に PATH を足す (すでにあれば何もしない)
add_to_path_unix() {
  local files=() f line
  case "${SHELL:-}" in
    */zsh) files=("${ZDOTDIR:-$HOME}/.zshrc") ;;
    */bash)
      files=("$HOME/.bashrc")
      # macOS のログインシェルは .bash_profile を読む。無いところへ作ると ~/.profile が読まれなくなるので、
      # .profile だけがあるならそちらに書く
      if [ "$(uname -s)" = Darwin ]; then
        if [ -f "$HOME/.bash_profile" ] || [ ! -f "$HOME/.profile" ]; then
          files+=("$HOME/.bash_profile")
        else
          files+=("$HOME/.profile")
        fi
      fi
      ;;
    *)
      info "このシェルの設定は自動では書けません。PATH に $INSTALL_HOME/bin を追加してください"
      return 0
      ;;
  esac
  line="export PATH=$(printf '%q' "$INSTALL_HOME/bin"):\$PATH"
  for f in "${files[@]}"; do
    if [ -f "$f" ] && grep -qF "$RC_BEGIN" "$f"; then continue; fi
    printf '\n%s\n%s\n%s\n' "$RC_BEGIN" "$line" "$RC_END" >>"$f"
    info "PATH を追加しました: $f"
  done
}

# Windows はユーザーの環境変数 PATH に足す (コマンドプロンプトや PowerShell からも使えるように)
add_to_path_windows() {
  local bin
  bin=$(cygpath -w "$INSTALL_HOME/bin" 2>/dev/null || printf '%s' "$INSTALL_HOME/bin")
  BIN_WIN="$bin" powershell.exe -NoProfile -Command '
    $e = $env:BIN_WIN
    $p = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not (($p -split ";") -contains $e)) {
      [Environment]::SetEnvironmentVariable("Path", (@($p, $e) | Where-Object { $_ }) -join ";", "User")
    }' || warn "PATH を追加できませんでした。ユーザーの環境変数 PATH に $bin を追加してください"
  info "PATH を追加しました (新しく開いたコマンドプロンプトから使えます)"
}

main() {
  need curl
  need grep
  need sed
  need awk
  need mktemp

  local tag url sums candidates ok=0 bin
  detect_target
  info "対象: $TARGET"

  # judgineer のものではない既存フォルダ (ホームなど) には入れない。uninstall が bin/ data/ を消すため
  if [ -n "$(ls -A "$INSTALL_HOME" 2>/dev/null)" ] && [ ! -e "$INSTALL_HOME/.judgineer-install" ]; then
    die "$INSTALL_HOME は空ではなく、judgineer のインストール先でもありません。JUDGINEER_HOME に別の (新しい) フォルダを指定してください"
  fi
  mkdir -p "$INSTALL_HOME/bin"
  bin="$INSTALL_HOME/bin/judgineer$EXT"
  TMP=$(mktemp -d "$INSTALL_HOME/.install.XXXXXX")

  # 取得に失敗したらここで止まる (プロセス置換だと die が握りつぶされる)
  candidates=$(list_candidates)
  # 最新から順に試し、バイナリがそろっている最初のリリースを使う
  while IFS=$'\t' read -r tag url sums; do
    [ -n "$tag" ] || continue
    info "取得中: $tag"
    if stage_release "$url" "$sums"; then
      ok=1
      break
    fi
    warn "$tag の取得に失敗しました。ひとつ前のリリースを試します"
  done <<<"$candidates"

  if [ "$ok" = 0 ]; then
    die "最新 $MAX_RELEASES 件のリリースに $TARGET 向けのバイナリと SHA256SUMS がそろったリリースが見つかりませんでした (ビルド中の可能性があります。しばらくしてからやり直してください)"
  fi

  # 動いているサーバーを止めてから入れ替える (解析データ data/ は触らない)
  [ ! -x "$bin" ] || "$bin" stop >/dev/null 2>&1 || true
  mv -f "$TMP/judgineer$EXT" "$bin"
  : >"$INSTALL_HOME/.judgineer-install" # uninstall が、ここが judgineer の場所だと確かめる目印
  printf '%s\n' "$tag" >"$INSTALL_HOME/version"

  if [ "$TARGET" = windows-x64 ]; then add_to_path_windows; else add_to_path_unix; fi

  info ""
  info "judgineer $tag をインストールしました: $INSTALL_HOME"
  if [ "$TARGET" != windows-x64 ]; then
    info "新しいターミナルを開くか、次を実行してください:"
    info "  export PATH=\"$INSTALL_HOME/bin:\$PATH\""
  fi
  info "使い方:  judgineer help"
  info "プロジェクトのフォルダで:  judgineer load"
  command -v claude >/dev/null 2>&1 ||
    warn "claude コマンドが見つかりません。AI の機能に Claude Code (claude) が必要です"
}

main "$@"
