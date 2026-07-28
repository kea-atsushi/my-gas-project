# Kea. Growth Ops

Shopify・GA4・Google広告・Merchant Center・Search Consoleを毎日取得し、利益確認、改善候補、承認待ちキュー、スマートフォン用ダッシュボードを作るGoogle Apps Scriptです。

## 安全方針

- Shopifyを商品・売上・公開状態の正とします。
- 広告停止、入札変更、予算変更は自動実行しません。`Recommendations`へ「承認待ち」で出します。
- `ADS_MUTATION_MODE`は`QUEUE_ONLY`を維持します。
- 原価が読めない場合、利益を確定値として表示しません。`DEFAULT_COGS_RATE`を設定した場合だけ推定します。
- EC商品はGoogle Indexing APIの対象外です。サイトマップ送信とURL検査は自動化し、インデックス登録リクエストはSearch Console画面で行います。
- APIキーとトークンはScript Propertiesだけに保存します。スプレッドシートやGitHubへ書きません。

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

## 導入

1. Apps Scriptでスタンドアロンプロジェクトを作成します。
2. `kea-growth-ops`配下をclaspで反映します。
3. Apps Scriptの「プロジェクトの設定」からScript Propertiesを登録します。
4. `setupKeaGrowthOps()`を手動実行し、権限を許可します。
5. 作成されたスプレッドシートの`Config`を確認します。
6. `runKeaGrowthUnitTests()`を実行します。
7. `runDailyGrowthReport(true)`を実行し、各APIの取得結果を確認します。
8. Webアプリを「自分のみ」「自分として実行」でデプロイします。

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
| `SEARCH_CONSOLE_SITE_URL` | 必須 | `sc-domain:kea.co.jp`またはURL-prefix |
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

## 出力

- `Daily`: 売上、利益、ROAS、CPA、CV、CTR、CPC、GA4、Search Console、Merchant
- `Products`: 人気商品
- `Ads`: キャンペーン別指標
- `SearchConsole`: 検索語句とページ
- `Merchant`: 商品承認状態と問題
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
