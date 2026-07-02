#!/usr/bin/env bash
set -euo pipefail

DUMMY_OAUTH_CLIENT_ID="dummy.apps.googleusercontent.com"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$PROJECT_ROOT/dist"
ENV_FILE="$PROJECT_ROOT/.env.local"

OPEN_BROWSER="${OPEN_BROWSER:-1}"

step() {
	printf '\n\033[1;34m==> %s\033[0m\n' "$1"
}

info() {
	printf '    %s\n' "$1"
}

warn() {
	printf '\033[1;33m注意:\033[0m %s\n' "$1"
}

fail() {
	printf '\033[1;31mエラー:\033[0m %s\n' "$1" >&2
	exit 1
}

usage() {
	cat <<'EOF'
Usage: scripts/setup-local-unpacked.sh [options]

Bookmark AI Extension をローカルの unpacked Chrome extension として使い始める
ための日本語ガイド付きセットアップです。

このスクリプトが自動で行うこと:
  - bun install
  - dummy OAuth client ID での初回 build
  - .env.local の作成/更新
  - dev OAuth client ID での再 build
  - 関連ページをブラウザで開く補助

人間が画面上で行うこと:
  - Chrome の Load unpacked
  - Google Cloud Console の OAuth consent screen 設定
  - Google Cloud Console の Chrome Extension OAuth client 作成
  - Chrome 拡張カードの reload ボタン押下

Options:
  --no-open       Chrome / Google Cloud Console の URL を自動で開かない
  -h, --help      このヘルプを表示して終了する

Environment:
  OPEN_BROWSER=0  --no-open と同じ
EOF
}

pause() {
	local prompt="${1:-Enter を押すと続行します...}"
	printf '\n%b' "$prompt" >&2
	if ! read -r _; then
		fail "入力が必要です。対話できるターミナルで再実行してください。"
	fi
}

prompt_required() {
	local prompt="$1"
	local value=""
	while [ -z "$value" ]; do
		printf '%b' "$prompt" >&2
		if ! read -r value; then
			fail "入力が必要です。対話できるターミナルで再実行してください。"
		fi
		value="$(printf '%s' "$value" | tr -d '[:space:]')"
	done
	printf '%s' "$value"
}

open_url() {
	local url="$1"
	if [ "$OPEN_BROWSER" = "0" ]; then
		info "自動オープンは無効です。手動で開いてください: $url"
		return 0
	fi

	if command -v open >/dev/null 2>&1; then
		if [ -d "/Applications/Google Chrome.app" ]; then
			open -a "Google Chrome" "$url" >/dev/null 2>&1 || open "$url" >/dev/null 2>&1 || true
		else
			open "$url" >/dev/null 2>&1 || true
		fi
	elif command -v xdg-open >/dev/null 2>&1; then
		xdg-open "$url" >/dev/null 2>&1 || true
	elif command -v cmd.exe >/dev/null 2>&1; then
		cmd.exe /c start "" "$url" >/dev/null 2>&1 || true
	else
		info "ブラウザを自動で開けませんでした。手動で開いてください: $url"
	fi
}

write_env_client_id() {
	local client_id="$1"

	if [ -f "$ENV_FILE" ]; then
		local backup="$PROJECT_ROOT/.env.backup.$(date +%Y%m%d%H%M%S).local"
		cp "$ENV_FILE" "$backup"
		info "既存の .env.local をバックアップしました: ${backup#$PROJECT_ROOT/}"
	fi

	local tmp
	tmp="$(mktemp)"
	if [ -f "$ENV_FILE" ]; then
		awk -v id="$client_id" '
			BEGIN { replaced = 0 }
			/^VITE_GOOGLE_OAUTH_CLIENT_ID=/ {
				print "VITE_GOOGLE_OAUTH_CLIENT_ID=" id
				replaced = 1
				next
			}
			{ print }
			END {
				if (replaced == 0) {
					print "VITE_GOOGLE_OAUTH_CLIENT_ID=" id
				}
			}
		' "$ENV_FILE" > "$tmp"
	else
		printf 'VITE_GOOGLE_OAUTH_CLIENT_ID=%s\n' "$client_id" > "$tmp"
	fi
	mv "$tmp" "$ENV_FILE"
}

validate_client_id() {
	local client_id="$1"
	case "$client_id" in
		*.apps.googleusercontent.com) return 0 ;;
		*)
			warn "OAuth Client ID は通常 .apps.googleusercontent.com で終わります。入力値を確認してください: $client_id"
			return 0
			;;
	esac
}

validate_extension_id() {
	local extension_id="$1"
	case "$extension_id" in
		????????????????????????????????) return 0 ;;
		*)
			warn "Chrome 拡張 ID は通常 32 文字です。入力値を確認してください: $extension_id"
			return 0
			;;
	esac
}

while [ "$#" -gt 0 ]; do
	case "$1" in
		--no-open)
			OPEN_BROWSER=0
			shift
			;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			usage >&2
			fail "不明なオプションです: $1"
			;;
	esac
done

cd "$PROJECT_ROOT"

step "Bookmark AI Extension ローカルセットアップ"
cat <<EOF
このスクリプトは、ローカルで Chrome 拡張を使うための手順を順番に案内します。

重要:
  - Google Cloud Console の画面操作は自動化できません。
  - Chrome の Load unpacked / reload クリックも手動です。
  - このスクリプトは「次に何を押すか」を表示し、build と .env.local 更新を自動化します。

Repository:
  $PROJECT_ROOT
EOF

step "1. 前提ツールを確認"
command -v bun >/dev/null 2>&1 || fail "bun が見つかりません。先に Bun をインストールしてください。"
info "bun: $(bun --version)"

if command -v just >/dev/null 2>&1; then
	info "just: available"
else
	warn "just が見つかりません。セットアップは続行できますが、検証コマンドには just が必要です。"
fi

step "2. 依存関係をインストール"
info "bun install を実行します。"
bun install

step "3. dummy OAuth client ID で初回 build"
cat <<EOF
Chrome Extension OAuth client を作るには、まず Chrome が生成した拡張 ID が必要です。
そのため、いったん dummy 値で build して dist/ を作ります。
EOF
VITE_GOOGLE_OAUTH_CLIENT_ID="$DUMMY_OAUTH_CLIENT_ID" bun run build
[ -d "$DIST_DIR" ] || fail "dist/ が作成されませんでした。"
info "dist/ を作成しました: $DIST_DIR"

step "4. Chrome で dist/ を Load unpacked"
open_url "chrome://extensions"
cat <<EOF
Chrome で以下を行ってください。

  1. chrome://extensions を開く
  2. 右上の「デベロッパー モード / Developer mode」を ON にする
  3. 「パッケージ化されていない拡張機能を読み込む / Load unpacked」を押す
  4. 次のフォルダを選択する

     $DIST_DIR

  5. 拡張カードに表示される「ID / Extension ID」をコピーする

例:
  fpmmgohhfcpcchpikdikflccpophhgnd
EOF

extension_id="$(prompt_required "\nコピーした Chrome 拡張 ID を貼り付けて Enter: ")"
validate_extension_id "$extension_id"

step "5. Google Drive API を有効化"
open_url "https://console.cloud.google.com/apis/library/drive.googleapis.com"
cat <<EOF
Google Cloud Console で以下を行ってください。

  1. 正しい Google Cloud プロジェクトを選ぶ
     - 未作成なら新規作成して OK
     - 例: Bookmark AI Extension Dev
  2. Google Drive API のページで「有効にする / Enable」を押す
  3. 既に有効なら何もしなくて OK
EOF
pause "\nGoogle Drive API を有効化できたら Enter: "

step "6. OAuth 同意画面を設定"
open_url "https://console.cloud.google.com/apis/credentials/consent"
cat <<EOF
ここが一番つまずきやすい「OAuth consent screen / OAuth 同意画面」です。
Google ログイン時に表示される「このアプリが Drive へのアクセスを求めています」画面を作ります。

画面で以下のように入力してください。

  A. User Type / Audience
     - 個人 Gmail で使うなら External を選ぶ
     - Google Workspace 内だけなら Internal でも可

  B. App name
     Bookmark AI Extension

  C. User support email
     自分のメールアドレスを選ぶ

  D. Developer contact information
     自分のメールアドレスを入力

  E. Scopes を聞かれた場合
     次の scope だけを追加する:
       https://www.googleapis.com/auth/drive.file

  F. Test users / テストユーザー
     必ず、Chrome でログインに使う Google アカウントを追加する。
     例:
       your-email@gmail.com

重要:
  「アクセスをブロック: Bookmark Extension は Google の審査プロセスを完了していません」
  と出る場合、多くは F の Test users に自分の Google アカウントが入っていません。

  ローカル開発では公開審査は不要です。
  Publishing status は Testing のままで OK です。
  ただし Testing 中は Test users に入れたアカウントだけがログインできます。
EOF
pause "\nOAuth 同意画面を保存し、Test users に自分を追加できたら Enter: "

step "7. Chrome Extension OAuth client を作成"
open_url "https://console.cloud.google.com/apis/credentials"
cat <<EOF
Google Cloud Console の Credentials / 認証情報 で以下を行ってください。

  1. 「Create credentials / 認証情報を作成」を押す
  2. 「OAuth client ID / OAuth クライアント ID」を選ぶ
  3. Application type / アプリケーションの種類 で
     「Chrome Extension / Chrome 拡張機能」を選ぶ
  4. Name は任意。例:
     Bookmark AI Extension Dev
  5. Extension ID / 拡張機能 ID に次を貼り付ける:

     $extension_id

  6. Create / 作成 を押す
  7. 表示された Client ID をコピーする

Client ID は通常この形です:
  xxxxx.apps.googleusercontent.com
EOF

client_id="$(prompt_required "\nコピーした OAuth Client ID を貼り付けて Enter: ")"
validate_client_id "$client_id"

step "8. .env.local を作成/更新"
write_env_client_id "$client_id"
info "更新しました: ${ENV_FILE#$PROJECT_ROOT/}"
info ".env.local は .gitignore 対象です。commit しません。"

step "9. real dev OAuth client ID で再 build"
bun run build

step "10. Chrome 拡張を reload"
open_url "chrome://extensions/?id=$extension_id"
cat <<EOF
Chrome に戻って以下を行ってください。

  1. Bookmark AI Extension のカードを探す
  2. reload / 更新 ボタンを押す
  3. エラーが出ず、有効なままであることを確認する

その後、普通の Web ページを開き、拡張 popup から Save を押してください。
初回は Google の同意画面が出ます。

同意画面で確認すること:
  - 要求権限が drive.file のみであること
  - 日本語なら概ね
    「このアプリで使用する特定の Google ドライブ ファイルのみを表示、編集、作成、削除」
    という意味の文言であること

もし「アクセスをブロック: Google の審査プロセスを完了していません」と出たら:
  1. Google Cloud Console の OAuth consent screen を開く
  2. Test users に、今 Chrome でログインしている Google アカウントを追加する
  3. 保存する
  4. Chrome 拡張を reload して、もう一度 Save する
EOF

pause "\nChrome 拡張を reload できたら Enter: "

step "11. 次に確認すること"
cat <<EOF
ローカルセットアップの自動化部分は完了です。

次に手動で確認してください。

  1. 通常の Web ページで popup から Save する
  2. Google OAuth に同意する
  3. Google Drive に bookmark-ai/ フォルダができることを確認する
  4. bookmark-ai/bookmarks.jsonl ができることを確認する
  5. options 画面で一覧・検索・削除を確認する

正式なリリース前の記録は docs/smoke-checklist.md に書いてください。

参考:
  - docs/local-unpacked-setup.md
  - docs/smoke-checklist.md
  - docs/publication.md
EOF
