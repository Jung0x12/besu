import { createInterface } from "readline/promises";
import { 
  createPublicClient, 
  createWalletClient, 
  http, 
  parseAbi, 
  parseUnits, 
  formatUnits,
  defineChain
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import dotenv from "dotenv";
import crypto from "crypto";

// Load environment variables
dotenv.config();

// ABI for TokenFactory
const TOKEN_FACTORY_ABI = parseAbi([
  "function createToken(string name, string symbol, address initialOwner) public returns (address)",
  "event TokenCreated(address indexed tokenAddress, address indexed owner)"
]);

// ABI for ERC20 Token
const TOKEN_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint amount) returns (bool)",
  "function approve(address spender, uint amount) returns (bool)",
  "function transferFrom(address sender, address recipient, uint amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function mint(address to, uint256 amount)",
  "function burn(uint256 amount)"
]);

// Configuration from .env
const config = {
  rpcUrl: process.env.RPC_URL || "http://localhost:8545",
  chainId: parseInt(process.env.CHAIN_ID || ""),
  tokenFactoryAddress: process.env.TOKEN_FACTORY_ADDRESS || "",
  privateKey: process.env.PRIVATE_KEY || ""
};

// Define the chain
const besuChain = defineChain({
  id: config.chainId,
  name: "Besu Private Chain",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: [config.rpcUrl]
    }
  }
});

// Initialize readline interface
const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

// Client and account objects
let publicClient: ReturnType<typeof createPublicClient>;
let walletClient: ReturnType<typeof createWalletClient>;
let account: ReturnType<typeof privateKeyToAccount>;
let userAddress: `0x${string}`;
let tokenAddress: `0x${string}` | null = null;

// Store multiple accounts
interface AccountInfo {
  name: string;
  privateKey: `0x${string}`;
  account: ReturnType<typeof privateKeyToAccount>;
  address: `0x${string}`;
}
let accounts: AccountInfo[] = [];
let currentAccountIndex = 0;

// Utility function to format amounts
function formatAmount(amount: bigint, decimals: number = 18): string {
  return formatUnits(amount, decimals);
}

// Utility function to parse amounts
function parseAmount(amount: string, decimals: number = 18): bigint {
  return parseUnits(amount, decimals);
}

// Helper to convert string address to 0x format
function toHexAddress(address: string): `0x${string}` {
  if (!address.startsWith('0x')) {
    return `0x${address}` as `0x${string}`;
  }
  return address as `0x${string}`;
}

// Connect to the blockchain and initialize clients
async function initialize() {
  try {
    console.log("Connecting to blockchain...");
    
    // Check if private key is provided
    if (!config.privateKey) {
      const inputPrivateKey = await rl.question("Enter your private key: ");
      config.privateKey = inputPrivateKey;
    }
    
    // Check if TokenFactory address is provided
    if (!config.tokenFactoryAddress) {
      const inputAddress = await rl.question("Enter TokenFactory contract address: ");
      config.tokenFactoryAddress = inputAddress;
    }
    
    // Create clients
    publicClient = createPublicClient({
      transport: http(config.rpcUrl),
      chain: besuChain
    });

    // Setup account from private key
    let privateKey = config.privateKey;
    if (!privateKey.startsWith("0x")) {
      privateKey = `0x${privateKey}`;
    }
    
    account = privateKeyToAccount(privateKey as `0x${string}`);
    userAddress = account.address;
    
    // Add initial account to accounts array
    accounts.push({
      name: "Default Account",
      privateKey: privateKey as `0x${string}`,
      account: account,
      address: userAddress
    });
    currentAccountIndex = 0;
    
    walletClient = createWalletClient({
      account,
      transport: http(config.rpcUrl),
      chain: besuChain
    });
    
    console.log(`Connected with account: ${userAddress}`);
    
    // Get balance
    const balance = await publicClient.getBalance({ address: userAddress });
    console.log(`Account balance: ${formatAmount(balance)} ETH`);
    
    console.log("Initialization complete!");
    
    await showMainMenu();
  } catch (error) {
    console.error("Initialization error:", error);
    process.exit(1);
  }
}

// Create a new token using TokenFactory
async function createToken() {
  try {
    const name = await rl.question("Enter token name: ");
    const symbol = await rl.question("Enter token symbol: ");
    const initialOwnerInput = await rl.question(`Enter initial owner address (default: ${userAddress}): `);
    const initialOwner = initialOwnerInput ? toHexAddress(initialOwnerInput) : userAddress;
    
    console.log(`Creating token ${name} (${symbol})...`);
    
    // Create token by calling the contract
    const hash = await walletClient.writeContract({
      address: toHexAddress(config.tokenFactoryAddress),
      abi: TOKEN_FACTORY_ABI,
      functionName: 'createToken',
      args: [name, symbol, initialOwner],
      chain: besuChain,
      account: account,
    });
    
    console.log(`Transaction sent: ${hash}`);
    console.log("Waiting for transaction confirmation...");
    
    // Wait for transaction receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    
    // Find the TokenCreated event
    const logs = await publicClient.getLogs({
      address: toHexAddress(config.tokenFactoryAddress),
      event: {
        type: 'event',
        name: 'TokenCreated',
        inputs: [
          { type: 'address', name: 'tokenAddress', indexed: true },
          { type: 'address', name: 'owner', indexed: true }
        ]
      },
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber
    });
    
    if (logs.length > 0 && logs[0].args.tokenAddress) {
      tokenAddress = logs[0].args.tokenAddress;
      console.log(`Token created successfully at address: ${tokenAddress}`);
      
      // Connect to the new token
      await showTokenDetails();
    } else {
      console.log("Token creation event not found in the transaction receipt");
    }
  } catch (error) {
    console.error("Error creating token:", error);
  }
  
  await showMainMenu();
}

// Connect to an existing token
async function connectToToken() {
  try {
    const addressInput = await rl.question("Enter token address: ");
    tokenAddress = toHexAddress(addressInput);
    
    // Verify the token by checking some basic properties
    await showTokenDetails();
    return true;
  } catch (error) {
    console.error("Error connecting to token:", error);
    tokenAddress = null;
    return false;
  }
}

// Mint tokens (only works if the connected wallet is the owner)
async function mintTokens() {
  if (!tokenAddress) {
    console.log("No token connected. Please connect to a token first.");
    await showMainMenu();
    return;
  }
  
  try {
    const recipientInput = await rl.question(`Enter recipient address (default: ${userAddress}): `);
    const recipient = recipientInput ? toHexAddress(recipientInput) : userAddress;
    const amount = await rl.question("Enter amount to mint: ");
    const decimals = await publicClient.readContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'decimals'
    });
    
    const amountInWei = parseAmount(amount, decimals);
    
    console.log(`Minting ${amount} tokens to ${recipient}...`);
    const hash = await walletClient.writeContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'mint',
      args: [recipient, amountInWei],
      chain: besuChain,
      account: account
    });
    
    console.log(`Transaction sent: ${hash}`);
    console.log("Waiting for transaction confirmation...");
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("Tokens minted successfully!");
    
    // Show updated balance
    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'balanceOf',
      args: [recipient]
    });
    
    console.log(`New balance of ${recipient}: ${formatAmount(balance, decimals)}`);
  } catch (error) {
    console.error("Error minting tokens:", error);
  }
  
  await showMainMenu();
}

// Burn tokens
async function burnTokens() {
  if (!tokenAddress) {
    console.log("No token connected. Please connect to a token first.");
    await showMainMenu();
    return;
  }
  
  try {
    const amount = await rl.question("Enter amount to burn: ");
    const decimals = await publicClient.readContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'decimals'
    });
    
    const amountInWei = parseAmount(amount, decimals);
    
    console.log(`Burning ${amount} tokens...`);
    const hash = await walletClient.writeContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'burn',
      args: [amountInWei],
      chain: besuChain,
      account: account
    });
    
    console.log(`Transaction sent: ${hash}`);
    console.log("Waiting for transaction confirmation...");
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("Tokens burned successfully!");
    
    // Show updated balance
    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'balanceOf',
      args: [userAddress]
    });
    
    console.log(`New balance: ${formatAmount(balance, decimals)}`);
  } catch (error) {
    console.error("Error burning tokens:", error);
  }
  
  await showMainMenu();
}

// Transfer tokens
async function transferTokens() {
  if (!tokenAddress) {
    console.log("No token connected. Please connect to a token first.");
    await showMainMenu();
    return;
  }
  
  try {
    const recipientInput = await rl.question("Enter recipient address: ");
    const recipient = toHexAddress(recipientInput);
    const amount = await rl.question("Enter amount to transfer: ");
    const decimals = await publicClient.readContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'decimals'
    });
    
    const amountInWei = parseAmount(amount, decimals);
    
    console.log(`Transferring ${amount} tokens to ${recipient}...`);
    const hash = await walletClient.writeContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'transfer',
      args: [recipient, amountInWei],
      chain: besuChain,
      account: account
    });
    
    console.log(`Transaction sent: ${hash}`);
    console.log("Waiting for transaction confirmation...");
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("Tokens transferred successfully!");
    
    // Show updated balance
    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'balanceOf',
      args: [userAddress]
    });
    
    console.log(`New balance: ${formatAmount(balance, decimals)}`);
  } catch (error) {
    console.error("Error transferring tokens:", error);
  }
  
  await showMainMenu();
}

// Approve tokens for spending
async function approveTokens() {
  if (!tokenAddress) {
    console.log("No token connected. Please connect to a token first.");
    await showMainMenu();
    return;
  }
  
  try {
    const spenderInput = await rl.question("Enter spender address: ");
    const spender = toHexAddress(spenderInput);
    const amount = await rl.question("Enter amount to approve: ");
    const decimals = await publicClient.readContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'decimals'
    });
    
    const amountInWei = parseAmount(amount, decimals);
    
    console.log(`Approving ${amount} tokens for ${spender}...`);
    const hash = await walletClient.writeContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'approve',
      args: [spender, amountInWei],
      chain: besuChain,
      account: account
    });
    
    console.log(`Transaction sent: ${hash}`);
    console.log("Waiting for transaction confirmation...");
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("Tokens approved successfully!");
    
    // Show updated allowance
    const allowance = await publicClient.readContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'allowance',
      args: [userAddress, spender]
    });
    
    console.log(`New allowance for ${spender}: ${formatAmount(allowance, decimals)}`);
  } catch (error) {
    console.error("Error approving tokens:", error);
  }
  
  await showMainMenu();
}

// Transfer tokens from another account (requires approval)
async function transferFromTokens() {
  if (!tokenAddress) {
    console.log("No token connected. Please connect to a token first.");
    await showMainMenu();
    return;
  }
  
  try {
    const senderInput = await rl.question("Enter sender address: ");
    const sender = toHexAddress(senderInput);
    const recipientInput = await rl.question("Enter recipient address: ");
    const recipient = toHexAddress(recipientInput);
    const amount = await rl.question("Enter amount to transfer: ");
    const decimals = await publicClient.readContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'decimals'
    });
    
    const amountInWei = parseAmount(amount, decimals);
    
    // Check allowance
    const allowance = await publicClient.readContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'allowance',
      args: [sender, userAddress]
    });
    
    if (allowance < amountInWei) {
      console.log(`Insufficient allowance. Current allowance: ${formatAmount(allowance, decimals)}`);
      await showMainMenu();
      return;
    }
    
    console.log(`Transferring ${amount} tokens from ${sender} to ${recipient}...`);
    const hash = await walletClient.writeContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'transferFrom',
      args: [sender, recipient, amountInWei],
      chain: besuChain,
      account: account
    });
    
    console.log(`Transaction sent: ${hash}`);
    console.log("Waiting for transaction confirmation...");
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("Tokens transferred successfully!");
    
    // Show updated balances
    const recipientBalance = await publicClient.readContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'balanceOf',
      args: [recipient]
    });
    
    console.log(`New balance of ${recipient}: ${formatAmount(recipientBalance, decimals)}`);
    
    // Updated allowance
    const newAllowance = await publicClient.readContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'allowance',
      args: [sender, userAddress]
    });
    
    console.log(`Remaining allowance: ${formatAmount(newAllowance, decimals)}`);
  } catch (error) {
    console.error("Error transferring tokens:", error);
  }
  
  await showMainMenu();
}

// Check token balance
async function checkBalance() {
  if (!tokenAddress) {
    console.log("No token connected. Please connect to a token first.");
    await showMainMenu();
    return;
  }
  
  try {
    const addressInput = await rl.question(`Enter address to check (default: ${userAddress}): `);
    const address = addressInput ? toHexAddress(addressInput) : userAddress;
    const decimals = await publicClient.readContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'decimals'
    });
    
    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'balanceOf',
      args: [address]
    });
    
    console.log(`Balance of ${address}: ${formatAmount(balance, decimals)}`);
  } catch (error) {
    console.error("Error checking balance:", error);
  }
  
  await showMainMenu();
}

// Show token details
async function showTokenDetails() {
  if (!tokenAddress) {
    console.log("No token connected. Please connect to a token first.");
    await showMainMenu();
    return;
  }
  
  try {
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      publicClient.readContract({
        address: tokenAddress,
        abi: TOKEN_ABI,
        functionName: 'name'
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: TOKEN_ABI,
        functionName: 'symbol'
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: TOKEN_ABI,
        functionName: 'decimals'
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: TOKEN_ABI,
        functionName: 'totalSupply'
      })
    ]);
    
    console.log("Token Details:");
    console.log(`Name: ${name}`);
    console.log(`Symbol: ${symbol}`);
    console.log(`Decimals: ${decimals}`);
    console.log(`Total Supply: ${formatAmount(totalSupply, decimals)}`);
    console.log(`Contract Address: ${tokenAddress}`);
    
    // Get the balance of the connected account
    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'balanceOf',
      args: [userAddress]
    });
    
    console.log(`Your balance: ${formatAmount(balance, decimals)}`);
  } catch (error) {
    console.error("Error fetching token details:", error);
    tokenAddress = null;
  }
  
  return tokenAddress !== null;
}

// Main menu
async function showMainMenu() {
  console.log("\n=== RWA Token Manager ===");
  console.log(`Current Account: ${accounts[currentAccountIndex].name} (${accounts[currentAccountIndex].address})`);
  console.log("\n=== Token Operations ===");
  console.log("1. Create new token");
  console.log("2. Connect to existing token");
  console.log("3. Mint tokens (owner only)");
  console.log("4. Burn tokens (owner only)");
  console.log("5. Transfer tokens");
  console.log("6. Approve tokens");
  console.log("7. Transfer tokens from another account");
  console.log("8. Check balance");
  console.log("9. Show token details");
  console.log("\n=== Account Management ===");
  console.log("10. Create new account");
  console.log("11. Import existing account");
  console.log("12. Switch account");
  console.log("\n0. Exit");
  
  const choice = await rl.question("Enter your choice: ");
  
  switch (choice) {
    case "1":
      await createToken();
      break;
    case "2":
      await connectToToken();
      await showMainMenu();
      break;
    case "3":
      await mintTokens();
      break;
    case "4":
      await burnTokens();
      break;
    case "5":
      await transferTokens();
      break;
    case "6":
      await approveTokens();
      break;
    case "7":
      await transferFromTokens();
      break;
    case "8":
      await checkBalance();
      break;
    case "9":
      await showTokenDetails();
      await showMainMenu();
      break;
    case "10":
      await createNewAccount();
      break;
    case "11":
      await importAccount();
      break;
    case "12":
      await switchAccount();
      break;
    case "0":
      console.log("Goodbye!");
      rl.close();
      process.exit(0);
      break;
    default:
      console.log("Invalid choice. Please try again.");
      await showMainMenu();
      break;
  }
}

// Generate a random private key
function generateRandomPrivateKey(): `0x${string}` {
  const randomBytes = crypto.randomBytes(32);
  return `0x${randomBytes.toString('hex')}` as `0x${string}`;
}

// Create a new account
async function createNewAccount() {
  try {
    const name = await rl.question("Enter a name for this account: ");
    const privateKey = generateRandomPrivateKey();
    const newAccount = privateKeyToAccount(privateKey);
    
    const accountInfo: AccountInfo = {
      name,
      privateKey,
      account: newAccount,
      address: newAccount.address
    };
    
    accounts.push(accountInfo);
    console.log(`New account created: ${name}`);
    console.log(`Address: ${accountInfo.address}`);
    console.log(`Private Key: ${privateKey} (Keep this secure!)`);
    
    // Ask if user wants to switch to this account
    const switchToNew = await rl.question("Switch to this account? (y/n): ");
    if (switchToNew.toLowerCase() === 'y') {
      currentAccountIndex = accounts.length - 1;
      await switchAccount();
    }
  } catch (error) {
    console.error("Error creating new account:", error);
  }
  
  await showMainMenu();
}

// Switch between accounts
async function switchAccount() {
  try {
    if (accounts.length === 0) {
      console.log("No accounts available. Please create an account first.");
      await createNewAccount();
      return;
    }
    
    // Display available accounts
    console.log("\nAvailable Accounts:");
    accounts.forEach((acc, index) => {
      console.log(`${index + 1}. ${acc.name} (${acc.address})${index === currentAccountIndex ? ' (Current)' : ''}`);
    });
    
    const choice = await rl.question("Select account number (or 'c' to create new): ");
    
    if (choice.toLowerCase() === 'c') {
      await createNewAccount();
      return;
    }
    
    const selectedIndex = parseInt(choice) - 1;
    if (selectedIndex >= 0 && selectedIndex < accounts.length) {
      currentAccountIndex = selectedIndex;
      account = accounts[currentAccountIndex].account;
      userAddress = account.address;
      
      // Update wallet client with the new account
      walletClient = createWalletClient({
        account,
        transport: http(config.rpcUrl),
        chain: besuChain
      });
      
      console.log(`Switched to account: ${accounts[currentAccountIndex].name}`);
      console.log(`Address: ${userAddress}`);
      
      // Get balance
      const balance = await publicClient.getBalance({ address: userAddress });
      console.log(`Account balance: ${formatAmount(balance)} ETH`);
    } else {
      console.log("Invalid selection. Please try again.");
    }
  } catch (error) {
    console.error("Error switching account:", error);
  }
  
  await showMainMenu();
}

// Import an existing account using private key
async function importAccount() {
  try {
    const name = await rl.question("Enter a name for this account: ");
    let privateKey = await rl.question("Enter private key: ");
    
    if (!privateKey.startsWith("0x")) {
      privateKey = `0x${privateKey}`;
    }
    
    const importedAccount = privateKeyToAccount(privateKey as `0x${string}`);
    
    const accountInfo: AccountInfo = {
      name,
      privateKey: privateKey as `0x${string}`,
      account: importedAccount,
      address: importedAccount.address
    };
    
    accounts.push(accountInfo);
    console.log(`Account imported: ${name}`);
    console.log(`Address: ${accountInfo.address}`);
    
    // Ask if user wants to switch to this account
    const switchToNew = await rl.question("Switch to this account? (y/n): ");
    if (switchToNew.toLowerCase() === 'y') {
      currentAccountIndex = accounts.length - 1;
      await switchAccount();
    }
  } catch (error) {
    console.error("Error importing account:", error);
  }
  
  await showMainMenu();
}

// Start the application
initialize().catch(error => {
  console.error("Application error:", error);
  process.exit(1);
});