# Kea. Growth Ops

Shopify・GA4・Google広告・Merchant Center・Search Consoleを毎日取得し、利益確認、改善候補、承認待ちキュー、スマートフォン用ダッシュボードを作るGoogle Apps Scriptです。

Merchantの商品同期・承認状態、Search ConsoleのSEO、GoogleビジネスプロフィールのMEOも既存の日次処理内で監視します。状態が変わった場合だけ専用メールを送ります。

Shopify SKU監査は、公開・下書き・アーカイブ・UNLISTEDを含む全バリエーションを毎日読み取ります。`custom.product_code`とサイズ・カラーの選択値から期待SKUを作り、空欄、形式違反、SKU重複、商品コード重複、商品コード欠落、option異常を`ShopifySkuAudit`へ出します。

## 安全方針

- Shopifyを商品・売上・公開状態の正とします。
- 広告停止、入札変更、予算変更は自動実行しません。`Recommendations`へ「承認待ち」で出します。
- `ADS_MUTATION_MODE`は`QUEUE_ONLY`を維持します。
- 原価が読めない場合、利益を確定値として表示しません。`DEFAULT_COGS_RATE`を設定した場合だけ推定します。
- EC商品はGoogle Indexing APIの対象外です。サイトマップ送信とURL検査は自動化し、インデックス登録リクエストはSearch Console画面で行います。
- APIキーとトークンはScript Propertiesだけに保存します。スプレッドシートやGitHubへ書きません。
- Merchant商品、広告、GoogleビジネスプロフィールはAPIから自動変更しません。対応案はすべて`Recommendations`の「承認待ち」です。
- Shopify SKU監査は読み取り専用です。SKU、商品、価格、在庫を更新せず、`write_products`権限も使用しません。

## 構成

```text
Shopify ─┐
GA4 ─────┤
Google Ads ─┤
Merchant ───┤→ GAS集約 → Sheets → 毎朝メール
Search Console ┘        ├→ 週次承認待ちキュー
                        └→ モバイルWebダッシュボード
```

新商品は1時間ごとに検出し、商品SEO監査、Merchant同期確認、サイトマップ再送信、URL検査、広告追加候補の作成まで行います。

`runDailyGrowthReport`は同じLockService内で`runGrowthHealthWatchCore_`を呼びます。追加トリガーは作りません。個別の手動確認は`runMerchantHealthWatchNow()`、`runSeoHealthAuditNow()`、`runMeoHealthAuditNow()`を使います。

SKU監査だけを手動確認する場合は`runShopifySkuAuditNow()`を使います。日次処理では既存のLockService内から監査コアだけを呼び、ロックを重ねません。

## Shopify SKU監査

期待SKUは次の順番で作ります。

```text
商品コード-サイズ-カラー
```

- 商品コードは`custom.product_code`だけを正とします。
- サイズは`Size`、`Size Detail`、`SizeDetail`、`size_detail`、`サイズ`、`サイズ詳細`、`実寸サイズ`を認識します。
- カラーは`Color`、`Colour`、`カラー`を認識します。
- サイズoption自体がない商品は`FREE`です。
- カラーoption自体がない商品は`ONECOLOR`です。
- optionがあるのに値が空欄の場合は代替値を入れず、要確認にします。
- 全角英数字は半角へ変換し、英字は大文字、空白は半角ハイフンへ正規化します。
- 商品コードや`ONE-SIZE`にハイフンが含まれるため、SKU文字列をハイフンで分割しません。
- 商品コード、サイズ、カラーは`ShopifySkuAudit`の別列で保持します。
- 商品状態の検索条件を付けず、GraphQL cursorで全variantをページングします。20,000件ごとにvariant IDの範囲を切り替え、通常connectionの25,000件上限を超える店舗でも全件取得を継続します。
- 監査シートは必要行数を確保した一時シートへ500行ずつ書き、成功後に差し替えます。API・書込失敗時は前回の全件結果を保持します。
- 監査結果は`Recommendations`へ承認待ちで追加します。Shopifyの商品は変更しません。

`custom.product_code`がない商品や、正式な商品コードを判断できない商品は例外として残します。内部IDや商品ハンドルから推測しません。

## 導入

既存のKea Growth Opsへ更新する場合、`setupKeaGrowthOps()`は再実行しません。追加シートは日次監視の初回実行時に安全に作成されます。

1. Apps Scriptでスタンドアロンプロジェクトを作成します。
2. `kea-growth-ops`配下をclaspで反映します。
3. Apps Scriptの「プロジェクトの設定」からScript Propertiesを登録します。
4. `setupKeaGrowthOps()`を手動実行し、権限を許可します。
5. 作成されたスプレッドシートの`Config`を確認します。
6. `runKeaGrowthUnitTests()`を実行します。
7. `runDailyGrowthReport(true)`を実行し、各APIの取得結果を確認します。
8. Webアプリを「自分のみ」「自分として実行」でデプロイします。

## GitHub Actionsからの配備

本番コードはGitHubを正とし、`main`へマージされた内容だけを手動でApps Scriptへ反映します。対象は固定のApps Scriptプロジェクト`Kea Growth Ops`です。PRや任意ブランチから本番配備はできません。

初回だけ、Apps Script所有者のGoogleアカウントで`clasp login`を行い、生成された`~/.clasprc.json`をBase64の1行へ変換します。その値をGitHub Environment `apps-script-production`のSecret `CLASPRC_JSON_B64`へ登録してください。OAuth認証情報をリポジトリ、Issue、PR、チャットへ貼らないでください。

Secret登録後の配備手順:

1. PRの`Validate Kea Growth Ops`が成功したことを確認して`main`へマージします。
2. GitHubの`Actions`から`Deploy Kea Growth Ops`を開きます。
3. ブランチ`main`、確認値`DEPLOY`を選んで実行します。
4. Workflowが静的テストを再実行し、Apps Scriptへ全ソースを反映して不変バージョンを記録します。

`clasp push --force`はApps Script側のソースをGitHubの内容で置き換えます。Apps Scriptエディタでコードを直接変更せず、変更はブランチとPRを通してください。Script Properties、初回の`setupKeaGrowthOps()`実行、Webアプリの初回デプロイは別途Apps Script上で行います。

## Script Properties

| Key | 必須 | 内容 |
|---|---|---|
| `REPORT_EMAILS` | 必須 | 送信先。カンマ区切り |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | いずれか | `read_orders`・`read_products`。原価取得は`read_inventory`も必要 |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | いずれか | Client Credentialsを使う場合 |
| `GA4_PROPERTY_ID` | 必須 | 数字だけ |
| `GOOGLE_ADS_CUSTOMER_ID` | 必須 | ハイフンなし |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | 必須 | Google Ads API |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | 任意 | MCC経由時 |
| `MERCHANT_ACCOUNT_ID` | 必須 | Merchant Center ID |
| `MERCHANT_DATA_SOURCE_ID` | 任意 | ファイル型データソースを即時再取得する場合 |
| `MERCHANT_SHOPIFY_CONNECTED_AT` | 任意 | Shopify接続日時。ISO 8601。未設定時は初回監視時刻から48時間を判定 |
| `SEARCH_CONSOLE_SITE_URL` | 必須 | `sc-domain:kea.co.jp`またはURL-prefix |
| `GBP_ACCOUNT_ID` | MEO接続時 | `GbpConnection`の候補から確認した`accounts/`形式のID |
| `GBP_LOCATION_ID` | MEO接続時 | `GbpConnection`の候補から確認した`locations/`形式のID |
| `OPENAI_API_KEY` | 任意 | `AI_MODE=OPENAI`時 |
| `OPENAI_MODEL` | 任意 | 既定`gpt-5.6-luna` |
| `AI_MODE` | 必須 | `RULES`または`OPENAI` |
| `DEFAULT_COGS_RATE` | 推奨 | 例`0.55`。実原価がない場合の推定 |
| `TARGET_CPA` | 任意 | 週次提案の基準 |
| `TARGET_ROAS` | 任意 | 週次提案の基準 |
| `ADS_MUTATION_MODE` | 固定推奨 | `QUEUE_ONLY` |

## 定期実行

- 毎日7時台: `runDailyGrowthReport`
- 毎週月曜8時台: `runWeeklyGrowthProposal`
- 1時間ごと: `monitorNewProducts`

Apps Scriptの時間主導トリガーは指定時刻の前後に実行されます。同時実行は`LockService`で防止し、日次・週次は成功キーで重複を防止します。

SEO・MEO・Merchant監視は日次処理へ統合済みです。新しい時間主導トリガーは追加しません。状態変化がない日は専用メールを送りません。API接続失敗は2回連続した時点で1回だけ通知します。

## 出力

- `Daily`: 売上、利益、ROAS、CPA、CV、CTR、CPC、GA4、Search Console、Merchant
- `Products`: 人気商品（ダッシュボードではブランド別にも集計）
- `Ads`: キャンペーン別指標
- `SearchConsole`: 検索語句とページ
- `Merchant`: 商品承認状態と問題
- `MerchantHealth`: 商品総数、承認、審査中、不承認、制限、同期状態、前回差分
- `MerchantIssues`: 商品・アカウントissue、重大度、解決方法、国、掲載先、解決URL、影響商品数
- `SEOHealth`: 7日比較、デバイス、サイトマップ、主要URL、canonical、旧EC URL
- `MEOHealth`: 店舗情報、営業時間、確認状態、口コミ、ローカル在庫リンク
- `GbpConnection`: API接続理由、確認済みID、候補、必要な1回の手動操作
- `ShopifySkuAudit`: 商品コード、サイズ、カラー、現在SKU、期待SKU、空欄、形式違反、重複、option異常
- `Recommendations`: 停止、追加、除外語句、入札、予算、SEO、商品改善の候補
- `ProductAutomation`: 新商品公開後の処理結果
- `RunLog`: 成功・失敗履歴

## 本番前の確認

- Shopifyの注文・商品取得権限
- GA4 purchaseイベントと売上値
- Google広告の購入コンバージョンが「主要」で重複なし
- Merchant CenterとShopify Google & YouTube連携
- Search Console所有権
- `DEFAULT_COGS_RATE`または商品原価
- 送信先メール

購入CVが0のまま広告費が発生している場合、コードは増額を提案しません。まず計測を直します。
