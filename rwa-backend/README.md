# RWA Token Backend

一個簡單的終端機操作應用程式，用於在Besu私有鏈上與ERC20代幣互動。

## 功能

- 使用TokenFactory合約創建新代幣
- 為ERC20代幣執行鑄造、燃燒、轉移、授權和從其他帳戶轉移等操作
- 查看代幣餘額和詳細信息

## 設置

1. 確保已安裝[Bun](https://bun.sh/)

2. 安裝依賴:
   ```
   bun install
   ```

3. 環境設置:
   創建`.env`文件並填入:
   ```
   # Besu Private Network
   RPC_URL=http://localhost:8545
   CHAIN_ID=1337

   # Contract Addresses
   TOKEN_FACTORY_ADDRESS=<你部署的合約地址>

   # Account
   PRIVATE_KEY=<你的私鑰，可以有或沒有0x前綴>
   ```

## 使用方法

運行應用:
```
bun run index.ts
```

按照交互菜單:
1. 創建新代幣
2. 連接到現有代幣
3. 執行代幣操作(鑄造、燃燒、轉移等)

## 技術實現

這個應用使用viem庫與以太坊區塊鏈交互，viem是一個現代化的TypeScript庫，擁有:
- 更好的TypeScript支持與更強的類型定義
- 更高性能
- 更模塊化的設計
- 更小的包體積

## 注意

確保您的Besu私有鏈正在運行，且您的賬戶有足夠的資金支付交易費用。
