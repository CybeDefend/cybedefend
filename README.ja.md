<p align="center">
  <a href="https://cybedefend.com"><img src="assets/banner.jpg" alt="CybeDefend: コーディングエージェントを守りの側に。オープンソースの Snyk 代替。" width="100%"></a>
</p>

<p align="center"><strong>コーディングエージェントでコマンドをひとつ。完全なセキュリティ監査。すべての脆弱性をエクスプロイトで証明。</strong><br>
オープンソースの Snyk 代替: セルフホスト型のエージェント型 AppSec と、あなたのコーディングエージェントが実行する AI スキャナー。</p>

<p align="center">
  <a href="https://github.com/CybeDefend/cybedefend/stargazers"><img src="https://img.shields.io/badge/Star%20on%20GitHub-7B5BFF?logo=github&logoColor=white" alt="Star CybeDefend on GitHub"></a>
  <a href="https://github.com/CybeDefend/cybedefend/tags"><img src="https://img.shields.io/github/v/tag/CybeDefend/cybedefend?sort=semver&label=release&color=7B5BFF" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-7B5BFF" alt="License: AGPL-3.0"></a>
  <a href="https://discord.gg/UPzm4n6SAJ"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://www.linkedin.com/company/101144768"><img src="https://img.shields.io/badge/LinkedIn-follow-0A66C2" alt="Follow CybeDefend on LinkedIn"></a>
</p>

<p align="center"><a href="#quick-start">Install</a> &bull; <a href="deploy/community/README.md">Docs</a> &bull; <a href="https://cybedefend.com">Website</a> &bull; <a href="https://discord.gg/UPzm4n6SAJ">Discord</a></p>

<p align="center"><a href="README.md">English</a> &bull; <a href="README.fr.md">Français</a> &bull; <a href="README.zh-CN.md">中文</a> &bull; <a href="README.ja.md">日本語</a> &bull; <a href="README.ko.md">한국어</a> &bull; <a href="README.es.md">Español</a> &bull; <a href="README.pt-BR.md">Português</a></p>

> [!NOTE]
> スターが、ほかの開発者がこのリポジトリを見つけるきっかけになります。2026 年 12 月 4 日に Product Hunt でローンチします。[Discord](https://discord.gg/UPzm4n6SAJ) でぜひ話しましょう。

**① コマンドひとつで完全な監査。**
コーディングエージェントで `/cybedefend` と入力します。オープンソースのスキャナーが走り、AI スキャナーがそれらには見えないものを探し、エージェントがすべての検出結果をあなたのコードに照らして判定します。答えは **SHIP**、または **NOT YET** と、ブロックしている項目およびそれぞれの修正です。

**② すべての脆弱性を証明。**
AI スキャナーは、エクスプロイトをひとつずつ、リポジトリ自身のテストスイートのテストとして書きます。検出結果は推測ではなく事実です。

**③ その裏に、オープンソースの AppSec プラットフォームが丸ごと。**
ホストするのはあなたです。チームのための dashboard、何をブロックするかを決めるポリシー、あなたのスタックとのインテグレーション、そしてコーディングエージェントが読む MCP サーバー。

<p align="center"><img src="assets/audit-run.gif" alt="コーディングエージェントのターミナルで /cybedefend を実際に実行した様子を早送りしたもの。コマンドが入力され、5 つのステップ (スキャナー、AI スキャナー、トリアージ、dashboard、レポート) が表示され、監査が走り、判定は NOT YET。続いてレポートが、ブロックしている証明済みの脆弱性を、それぞれのエクスプロイトテストと修正とともに一覧します。" width="100%"></p>

<p align="center">あなたのコードで脆弱性を証明できたら、スターをお願いします。ほかの開発者が見つけやすくなります。</p>

<br>

<a id="quick-start"></a>
# クイックスタート

```bash
npx skills add CybeDefend/cybedefend -g
```

監査したいリポジトリでコーディングエージェントを開き、次のように入力します。

```text
/cybedefend
```

インストールはこれですべてです。コピーするトークンも、編集するファイルも、起動するサーバーもありません。

- **対応エージェント**: Claude Code、Codex、Cursor、そして skills を読むすべてのコーディングエージェント。
- **必要なもの**: 起動している Docker (Docker Compose 2.24.4 以降)、約 4 GB のメモリ、git、Node.js。
- **答え**: **SHIP**、または **NOT YET** と、ブロックしている項目およびそれぞれの修正。

<details>
<summary><b>初回実行が自動でセットアップするもの</b></summary>

<br>

何も尋ねません。

1. Docker Compose で dashboard をあなたのマシン上に起動します。8080 以降で最初に空いているポートを使い、`127.0.0.1` にバインドします。初回は Docker がイメージをダウンロードします (約 6 GB、数分)。2 回目以降の実行は数秒で終わり、何も変更しません。
2. 最初の管理者と personal access token を作成し、`~/.cybedefend/appsec/credentials.json` に保存します (モード 600、画面には決して表示しません)。
3. リポジトリのプロジェクトを作成し、チームにポリシーがなければデフォルトのポリシーも作成します。critical と high の検出結果はブロック、コード内のシークレットもすべてブロック、medium の検出結果は警告です。
4. MCP サーバーを Claude Code に接続します。ほかのエージェントの場合は、追加すべきアドレスを表示します。

公開イメージを pull できない場合、初回実行はソースからイメージをビルドし、その旨を伝えます (15 分から 30 分、一度だけ)。

</details>

<br>

# 仕組み

コマンドひとつ。ステップ 5 つ。判定ひとつ。

| ステップ | 何が起きるか |
|---|---|
| **1.&nbsp;スキャナー** | オープンソースのスキャナーが既知のパターンを見つけます。 |
| **2.&nbsp;AI&nbsp;スキャナー** | コーディングエージェントがすべてのエントリーポイントをマッピングし、コードが決して許してはならないことを書き出し、ビジネスロジック、アクセス権、テナント、アイデンティティ、競合状態を探し、それぞれの脆弱性を、あなた自身のスイートのテストとして書いたエクスプロイトで証明します。 |
| **3.&nbsp;トリアージ** | エージェントがスキャナーの検出結果をひとつずつ、あなたのコードに照らして判定します。 |
| **4.&nbsp;Dashboard** | あなたのポリシーが判定を下します: **SHIP** または **NOT YET**。 |
| **5.&nbsp;レポート** | ブロックしている項目と、それぞれの修正。 |

**AI スキャナーを実行するのは、あなた自身のコーディングエージェントです。** 追加のモデルも API キーも要りません。

**安全に実行できます。** 監査はアプリケーションコードを一切変更しません。AI スキャナーは、デプロイ済みのシステムにも第三者にもリクエストを送らず、実在の認証情報や個人データも使いません。

<details>
<summary><b>AI スキャナーが具体的に行うこと</b></summary>

<br>

コードのすべてのエントリーポイント (ルート、メッセージコンシューマー、スケジュールジョブ、webhook) を 1 行ずつ列挙し、誰が呼び出せるか、それを強制するチェックは何かを添えます。コードの保証は平易な文で書き出します。メンバーは自分のチームのドキュメントだけを見られる、送金によって残高がゼロを下回ることはない、といった形です。

初回実行はリポジトリ全体をレビューします。2 回目以降は、ブランチが変更した箇所と、そこに到達するエントリーポイントをレビューします。そのスコープ内のすべての行を、ロールごとにレビューします。

手がかりが検出結果になるのは、あなた自身のテストフレームワークのテストが、主張どおりの理由で失敗したときです。それ以外の手がかりはすべて、ブロックできないメモとして dashboard に送られます。

レポートは、レビューしたエントリーポイント、採用した検出結果、除外した検出結果の数を、理由とともに示します。

</details>

<details>
<summary><b>具体的に何がブロックするのか</b></summary>

<br>

ポリシーは組織、チーム、プロジェクトのいずれかに適用されます。YAML で書かれ、インポートもエクスポートもできます。各ルールは、重大度、CVSS スコア、CWE、OWASP カテゴリ、スキャナーの種類、経過日数、ブランチを、単独または組み合わせて検出結果にマッチさせます。

Block ルールは判定を NOT YET にし、`/cybedefend` は終了コード 1 で終了します。Warn ルールは違反を記録します。ポリシーは、スキャンとインポートが終わるたびに判定をやり直します。

</details>

<br>

# プラットフォーム

コマンドの裏には、完全なオープンソースの AppSec プラットフォームがあります。あなたがホストし、チームがその中で作業し、コーディングエージェントが MCP サーバー経由で読み取ります。

### 組織全体をひとつのビューで

<p align="center"><img src="assets/screens/overview.jpg" alt="dashboard の組織概要: 1 チームに 34 プロジェクト、未解決の検出結果 2,939 件、解決されたものと新しいもの、重大度別およびスキャナー別の未解決の検出結果" width="100%"></p>

### すべての検出結果を、ブランチごとに

<p align="center"><img src="assets/screens/findings.jpg" alt="dashboard に表示されたプロジェクトの検出結果: main ブランチでの重大度、ファイルと行、CVSS スコア、ステータス" width="100%"></p>

### 何をブロックするかは、あなたのポリシーが決める

<p align="center"><img src="assets/screens/policies.jpg" alt="プロジェクトが従うポリシー: Block ルール 2 つと Warn ルール 1 つ" width="100%"></p>

<details>
<summary><b>オープンソース版に含まれるすべて</b></summary>

<br>

| 機能 | 得られるもの |
|---|---|
| **コードに追従する検出結果** | スキャンがクリーンなら解決済みに、再発すれば再オープン |
| **セキュリティポリシー** | Block ルールと Warn ルールを YAML で |
| **組織、チーム、ロール** | 組織ロール 4 つ、チームロール 4 つ |
| **プロジェクトごとのリスクスコア** | CybeRisk レベル、リスクの高い順 |
| **レポート** | OWASP Top 10 と CWE Top 25 を PDF、HTML、JSON で |
| **MCP サーバー** | コーディングエージェント向けに 21 tools |
| **Personal access token** | CI、インポート API、MCP サーバー用 |
| **セルフホスト** | Docker Compose と PostgreSQL 18 を、あなたのサーバーで |
| **シート数の上限なし、テレメトリなし** | スキャン回数の上限なし、レポートは期限なしで保持 |

</details>

<br>

# インテグレーション

あなたのスタックにつながります。

<p align="center"><img src="assets/integrations.jpg" alt="オープンソース版で、あなたのスタックにつながります: GitHub、GitLab とセルフマネージドの GitLab、GitHub Actions、GitLab CI、Jira、Linear、Slack、メール、21 tools を備えた MCP サーバー、インポート API、Docker Compose、Kubernetes" width="100%"></p>

<details>
<summary><b>各インテグレーションができること</b></summary>

<br>

| インテグレーション | できること |
|---|---|
| **GitHub** | あなたが作成する GitHub App。リポジトリの連携、スキャン終了時に issue を作成し、含まれる検出結果がすべて解決されるとクローズ、クラスターがあれば push ごとにスキャン。 |
| **GitLab** | GitLab.com またはあなた自身の GitLab で、GitHub と同じ機能。 |
| **Jira と Linear** | 検出結果から、または各スキャンの終了時にチケットを作成。 |
| **Slack とメール** | スキャン完了時、毎週、毎月にメッセージ。 |
| **GitHub Actions と GitLab CI** | pull request ごとにスキャナーを実行し、結果はあなたの dashboard へ。そのほかの CI では `docker run` で実行できます。 |
| **コーディングエージェント** | skills を読むあらゆるエージェント向けの 2 つの skill と、21 tools を備えた MCP サーバー。 |
| **そのほかのスキャナー** | あらゆる SARIF 2.1.0 ファイルを、インポート API または `/cybedefend import` で。パッケージの完全な一覧には CycloneDX SBOM を添えられます。 |
| **Docker Compose と Kubernetes** | プラットフォームは Docker Compose で動きます。Kubernetes クラスターを接続すれば、スキャナーごとに 1 pod でスキャンを自ら実行します。 |

各インテグレーションは、それぞれの設定で有効にします。[deploy/community/README.md](deploy/community/README.md) に、各プロバイダーのコールバックアドレスとともに一覧があります。

</details>

<br>

# コマンド

デプロイのたびに、その前に `/cybedefend` と入力します。ほかのコマンドは、その 1 ステップだけを実行するか、さらに踏み込みます。

| コマンド | できること |
|---|---|
| `/cybedefend` | 完全な監査。初回実行ではリポジトリ全体、それ以降はブランチが変更した箇所。 |
| `/cybedefend deep` | リリース向けの重い監査。すべての関数に判定を出します。 |
| `/cybedefend fix` | ブロックしている項目を修正し、修正はそれぞれテストで証明します。 |
| `/cybedefend audit` | リポジトリ全体をもう一度監査し、そのレビューを書いていない 2 つのエージェントが検証します。 |
| `/cybedefend scan` | スキャナーと判定。`--quick` は中核のスキャナーを実行します。 |
| `/cybedefend triage` | スキャナーの検出結果をひとつずつ、あなたのコードに照らして判定します。 |
| `/cybedefend live` | 証明済みの脆弱性を、あなたのマシン上のアプリケーションで、使い捨てのデータを使って再現します。 |
| `/cybedefend import <file>` | ほかのツールの SARIF ファイルをあなたの dashboard に送ります。 |
| `/cybedefend report` | 直近の実行のレポート。 |
| `/cybedefend open` | dashboard と、直近の実行の監査ページを開きます。 |
| `/cybedefend replay` | 直近の実行のページを、起きたとおりにもう一度再生します。 |
| `/cybedefend setup` | セットアップのみ。 |
| `/cybedefend-setup` | 2 つ目の skill: サーバー、HTTPS、または Kubernetes クラスター上でのスキャン。 |

<br>

# スキャナー

チームに必要なスキャナーがすべて揃っています。どれが走るかは、リポジトリのスタックで決まります。

<p align="center"><img src="assets/scanners.png" alt="推奨するオープンソースのスキャナー: コードには Opengrep、依存関係と infrastructure as code には Trivy、シークレットには Gitleaks、CI/CD には zizmor、Python には Bandit、Go には gosec、Ruby には Brakeman、infrastructure as code には Checkov、CI/CD には poutine。または SARIF 経由で手持ちのツールを: Semgrep、CodeQL、Grype、TruffleHog、そして SARIF 2.1.0 を出力するあらゆるツール" width="100%"></p>

これらは私たちが推奨するスキャナーです。ほかのスキャナーもすべて使えます。

| 領域 | ツールの例 |
|---|---|
| **コード** | Opengrep, Bandit, gosec, Brakeman<br><sub>ソースファイル</sub> |
| **依存関係** | Trivy、パッケージの完全な一覧 (SBOM) 付き<br><sub>lockfile または固定されたバージョン</sub> |
| **シークレット** | Gitleaks<br><sub>git から見えるファイル</sub> |
| **Infrastructure as code (IaC)** | Trivy, Checkov<br><sub>Terraform, Kubernetes, Helm, Dockerfile, CloudFormation</sub> |
| **CI/CD** | zizmor, poutine<br><sub>GitHub Actions, GitLab CI, Azure Pipelines, Tekton</sub> |
| **コンテナ** | Trivy<br><sub>あなたが指定するイメージ</sub> |

- **オープンソースで、選ぶのはあなた**。ツールごとに 1 イメージ、[`CybeDefend/cybedefend-scanners`](https://github.com/CybeDefend/cybedefend-scanners) にあります。
- **あなたのマシンには何もインストールしません。**
- **さらに、SARIF を出力するすべてのスキャナー**を `/cybedefend import <file>` で。

<details>
<summary><b>SARIF 経由で、そのまま使い続けられるツール</b></summary>

<br>

| 領域 | 使い続けられるツール |
|---|---|
| **コード** | Semgrep, CodeQL, SonarQube, Snyk Code, ESLint security rules |
| **依存関係** | Grype, osv-scanner, Snyk Open Source, OWASP Dependency-Check |
| **Infrastructure as code (IaC)** | KICS, tfsec, Terrascan, Kubescape |
| **シークレットと CI/CD** | TruffleHog, detect-secrets, actionlint |
| **そのほか** | SARIF 2.1.0 を出力するあらゆるツール |

</details>

<br>

# 一年を通して、監査に備えた状態に

SOC 2 と ISO 27001 の監査人が求める証跡を、あなたが作業している間に保持します。

| 監査人が求めるもの | CybeDefend が保持するもの |
|---|---|
| 期限内に対処された脆弱性<br><sub>ISO 27001 A.8.8, SOC 2 CC7.1</sub> | すべての検出結果と、その日付、重大度、ステータスの履歴 |
| セキュアコーディングとテスト<br><sub>ISO 27001 A.8.28, A.8.29</sub> | pull request ごとのスキャンと、AI スキャナーが証明した脆弱性それぞれのテスト |
| 変更管理<br><sub>ISO 27001 A.8.25, SOC 2 CC8.1</sub> | スキャンとインポートのたびに判定されるあなたのポリシーと、記録された違反のひとつひとつ |
| 監査証跡 | OWASP Top 10 と CWE Top 25 のレポートを PDF で |

<br>

# ドキュメント

- **セルフホストガイド**: [deploy/community/README.md](deploy/community/README.md)。HTTPS とリバースプロキシ、シークレットキー、インテグレーション、アップグレード、バックアップ、イメージの検証方法を扱います。
- **CI でのスキャナー**: [CybeDefend/cybedefend-scanners](https://github.com/CybeDefend/cybedefend-scanners)。
- **ビルドとテスト**: [CONTRIBUTING.md](CONTRIBUTING.md)。
- **脆弱性の報告**: [SECURITY.md](SECURITY.md)。

## CI で使う

[CybeDefend/cybedefend-scanners](https://github.com/CybeDefend/cybedefend-scanners) のスキャナーイメージは、pull request ごとに実行され、結果をあなたの dashboard に送ります。ワークフローの全体、commit による固定、すべてのオプションはそちらに記載されています。

必要なのは、runner から到達できるインスタンス、プロジェクト、そしてそのプロジェクトでスキャンを開始できるユーザーの personal access token です。

<details>
<summary><b>GitHub Actions</b>、スキャナーごとに 1 ステップ</summary>

<br>

```yaml
- uses: CybeDefend/cybedefend-scanners@v1.0.0
  with:
    scanner: opengrep
    api-url: ${{ vars.CYBEDEFEND_API_URL }}
    project-id: ${{ vars.CYBEDEFEND_PROJECT_ID }}
    token: ${{ secrets.CYBEDEFEND_TOKEN }}
```

</details>

<details>
<summary><b>GitLab CI</b>、スキャナーごとに 1 ジョブ</summary>

<br>

```yaml
include:
  - remote: https://raw.githubusercontent.com/CybeDefend/cybedefend-scanners/v1.0.0/templates/gitlab/cybedefend-scanners.gitlab-ci.yml

sast:
  extends: .cybedefend-sast
```

</details>

<details>
<summary><b>そのほかの CI</b>、<code>docker run</code> またはインポート用ルートで</summary>

<br>

スキャナーイメージを `--upload` 付きで `docker run` するか、任意のツールの SARIF を personal access token を使ってインポート用ルートに送ります。

```bash
curl -H "Authorization: Bearer cdp_…" \
  -F file=@results.sarif -F type=sast -F branch=main \
  "$CYBEDEFEND_PUBLIC_URL/api/project/<projectId>/scan/import/start"
```

`type` は `sast`、`iac`、`secret`、`cicd`、`sca`、`container` のいずれかです。

</details>

## サーバー上、または Kubernetes クラスター上で

```text
/cybedefend-setup
```

セットアップ用の skill が、あなたと一緒にインスタンスをインストールします。同じ `npx skills add` で一緒に入っています。

<details>
<summary><b>セットアップ用の skill が行うこと</b></summary>

<br>

Docker と、見える範囲の Kubernetes クラスターを確認し、選択肢ごとにデフォルトを採用し、自分では決められないこと (それらのクラスターのひとつでスキャンするか、サーバーのドメイン) を尋ね、一度だけ確認してから、設定を書き込み、クラスターを接続し、スタックを起動します。

クラスターを接続すると、インスタンスは専用の namespace でスキャナーごとに 1 pod を起動します。**Import results** の隣に **Start scan** が現れ、アップロードした ZIP アーカイブがスキャンされ、GitHub または GitLab に連携したプロジェクトは push ごとにスキャンできます。

</details>

<details>
<summary><b>手動でインストールする</b></summary>

<br>

Docker Compose 2.24.4 以降と約 4 GB の RAM が必要です。スタックには専用の PostgreSQL 18 が含まれています。

```bash
git clone https://github.com/CybeDefend/cybedefend && cd cybedefend/deploy/community

# The master key: at least 32 random bytes, in a file readable by you alone.
(umask 077 && openssl rand -base64 32 > secret-key)
cp .env.example .env

# In .env, set the two required values:
#   CYBEDEFEND_SETUP_TOKEN  a long random string, for example: openssl rand -hex 32
#   CYBEDEFEND_PUBLIC_URL   the address users open, http://localhost:8080 by default
docker compose up -d
```

`CYBEDEFEND_PUBLIC_URL` で dashboard を開き、`CYBEDEFEND_SETUP_TOKEN` を入力して最初の管理者を作成します。

マスターキー (`secret-key`) はバックアップを取り、決して変更しないでください。インテグレーションの認証情報、シークレットの検出結果、サインイン用の鍵を暗号化しています。

</details>

<br>

# 創業チーム

<table align="center">
  <tr>
    <td align="center" valign="top" width="200">
      <img src="assets/team/julien.png" width="120" alt="Julien Zammit"><br>
      <b>Julien Zammit</b><br>
      <sub>共同創業者 兼 CEO</sub><br>
      <a href="https://x.com/JulienZammit1">X</a> &bull; <a href="https://www.linkedin.com/in/julienzammit">LinkedIn</a>
    </td>
    <td align="center" valign="top" width="200">
      <img src="assets/team/florentin.png" width="120" alt="Florentin Ledy"><br>
      <b>Florentin Ledy</b><br>
      <sub>共同創業者 兼 CPTO</sub><br>
      <a href="https://www.linkedin.com/in/florentin-ledy">LinkedIn</a> &bull; <a href="https://github.com/FlorentinLedy">GitHub</a>
    </td>
    <td align="center" valign="top" width="200">
      <img src="assets/team/axel.png" width="120" alt="Axel Paulin"><br>
      <b>Axel Paulin</b><br>
      <sub>共同創業者 兼 COO</sub><br>
      <a href="https://www.linkedin.com/in/axel-paulin">LinkedIn</a>
    </td>
  </tr>
</table>

<br>

<p align="center">監査であなたのコードに何か見つかったら、スターをお願いします。ほかの開発者がこのプロジェクトを見つけやすくなります。</p>

<br>

# コントリビューション

issue と pull request を歓迎します。まず [CONTRIBUTING.md](CONTRIBUTING.md) をお読みください。
脆弱性を報告するには、[SECURITY.md](SECURITY.md) に従ってください。
私たちと話すには、[Discord](https://discord.gg/UPzm4n6SAJ) に参加してください。

## ライセンス

GNU Affero General Public License v3 (AGPL-3.0-only、LICENSE を参照) のもとで公開されているオープンソースです。Copyright (C) 2026 CybeDefend SAS。ネットワーク条項 (AGPL 第 13 条): 本ソフトウェアを改変し、ネットワーク越しにユーザーに利用させる場合、改変したソースをそのユーザーに提供しなければなりません。このエディションはテレメトリを送信しません。あなたのインスタンスから CybeDefend へは何も送られません。

[LICENSE](LICENSE) &bull; [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) &bull; [TRADEMARKS.md](TRADEMARKS.md) &bull; [CONTRIBUTING.md](CONTRIBUTING.md) &bull; [SECURITY.md](SECURITY.md)

<br>

<p align="center"><sub>AGPL-3.0-only。スキャナーはそれぞれ独自のライセンスを保持します。開発: <a href="https://cybedefend.com">CybeDefend</a>。<br>Snyk と GitHub は各所有者の商標です。CybeDefend はこれらと提携していません。</sub></p>
