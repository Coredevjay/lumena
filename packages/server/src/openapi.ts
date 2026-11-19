export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Lumen Server API",
    description:
      "API specification and documentation portal for @lumen/server co-signing, fee sponsorship, and policy engine services.",
    version: "0.1.0",
  },
  servers: [
    {
      url: "http://localhost:3000",
      description: "Local development server",
    },
  ],
  paths: {
    "/health": {
      get: {
        summary: "Health Check",
        description:
          "Returns the operational status of the server and the configured Stellar network.",
        responses: {
          "200": {
            description: "Server is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    network: { type: "string", example: "testnet" },
                  },
                  required: ["status", "network"],
                },
              },
            },
          },
        },
      },
    },
    "/auth/challenge": {
      get: {
        summary: "SEP-10 Challenge",
        description:
          "Generates a SEP-10 challenge transaction envelope signed by the server for the given Stellar account. " +
          "The client must sign the challenge transaction and submit it to POST /auth/token to obtain a JWT.",
        security: [],
        parameters: [
          {
            name: "account",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Stellar public key (G...) of the account requesting authentication.",
            example: "GAD7654...",
          },
        ],
        responses: {
          "200": {
            description: "SEP-10 challenge transaction envelope",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    transaction: {
                      type: "string",
                      description: "Base64 encoded challenge transaction envelope XDR.",
                      example: "AAAAAG...",
                    },
                    network_passphrase: {
                      type: "string",
                      description: "Stellar network passphrase the challenge is valid for.",
                      example: "Test SDF Network ; September 2015",
                    },
                  },
                  required: ["transaction", "network_passphrase"],
                },
              },
            },
          },
          "400": { description: "Missing or invalid account parameter" },
        },
      },
    },
    "/auth/token": {
      post: {
        summary: "SEP-10 Token Exchange",
        description:
          "Validates the client signature on a SEP-10 challenge transaction and issues a JWT valid for 24 hours.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  transaction: {
                    type: "string",
                    description: "Base64 encoded signed challenge transaction envelope XDR.",
                    example: "AAAAAG...",
                  },
                },
                required: ["transaction"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "JWT issued successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    token: {
                      type: "string",
                      description: "Signed JWT valid for 24 hours.",
                      example: "eyJhbGciOi...",
                    },
                  },
                  required: ["token"],
                },
              },
            },
          },
          "400": { description: "Invalid or malformed challenge transaction" },
          "401": { description: "Challenge signature verification failed or challenge expired" },
        },
      },
    },
    "/cosign": {
      post: {
        summary: "Cosign Transaction",
        description:
          "Validates transaction operations against active policy rules and appends co-signer signature if approved.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  xdr: {
                    type: "string",
                    description: "Base64 encoded Stellar transaction envelope XDR.",
                    example: "AAAAAG...",
                  },
                  walletAddress: {
                    type: "string",
                    description: "Stellar public key address of the originating wallet.",
                    example: "GAD7654...",
                  },
                },
                required: ["xdr", "walletAddress"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Transaction approved and co-signed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    signedXdr: { type: "string", example: "AAAAAG..." },
                  },
                  required: ["signedXdr"],
                },
              },
            },
          },
          "400": { description: "Invalid request validation error" },
          "401": { description: "Missing or invalid tenant API key" },
          "403": { description: "Transaction denied by policy rules" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/cosign/batch": {
      post: {
        summary: "Batch Cosign Transactions",
        description:
          "Validates and co-signs multiple transactions in a single request. Policies are evaluated atomically across all items; the response reports per-item results, including item-level policy failures.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  transactions: {
                    type: "array",
                    description: "Transactions to evaluate and co-sign.",
                    minItems: 1,
                    items: {
                      type: "object",
                      properties: {
                        xdr: {
                          type: "string",
                          description: "Base64 encoded Stellar transaction envelope XDR.",
                          example: "AAAAAG...",
                        },
                        walletAddress: {
                          type: "string",
                          description: "Stellar public key address of the originating wallet.",
                          example: "GAD7654...",
                        },
                      },
                      required: ["xdr", "walletAddress"],
                    },
                  },
                },
                required: ["transactions"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Batch processed; per-item results returned",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    results: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          index: {
                            type: "integer",
                            description: "Position of the item in the request array.",
                            example: 0,
                          },
                          signedXdr: {
                            type: "string",
                            description: "Co-signed XDR, present when approved.",
                            example: "AAAAAG...",
                          },
                          approved: { type: "boolean", example: true },
                          reason: {
                            type: "string",
                            description: "Human-readable explanation when not approved.",
                            example: "Transaction denied by policy rules",
                          },
                          code: {
                            type: "string",
                            description: "Machine-readable error code when not approved.",
                            example: "POLICY_DENIED",
                          },
                        },
                        required: ["index", "approved"],
                      },
                    },
                  },
                  required: ["results"],
                },
              },
            },
          },
          "400": { description: "Invalid request validation error" },
          "401": { description: "Missing or invalid tenant API key" },
          "403": { description: "Batch denied by policy or fraud rules" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/fee-bump": {
      post: {
        summary: "Wrap Fee-Bump Transaction",
        description:
          "Wraps a transaction envelope in a FeeBumpTransaction signed by the fee sponsor account.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  xdr: {
                    type: "string",
                    description: "Base64 encoded Stellar transaction envelope XDR to wrap.",
                    example: "AAAAAG...",
                  },
                },
                required: ["xdr"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Fee bump transaction wrapped successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    feeBumpXdr: { type: "string", example: "AAAAAG..." },
                  },
                  required: ["feeBumpXdr"],
                },
              },
            },
          },
          "401": { description: "Missing or invalid tenant API key" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/fee-bump/submit": {
      post: {
        summary: "Submit Fee-Bump Transaction",
        description:
          "Wraps and immediately submits a transaction to the Stellar network using the fee sponsor account.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  xdr: {
                    type: "string",
                    description: "Base64 encoded Stellar transaction envelope XDR.",
                    example: "AAAAAG...",
                  },
                },
                required: ["xdr"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Transaction submitted successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    hash: { type: "string", example: "7f3b..." },
                    successful: { type: "boolean", example: true },
                  },
                },
              },
            },
          },
          "401": { description: "Missing or invalid tenant API key" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/wallets": {
      get: {
        summary: "List Registered Wallets",
        description:
          "Returns all wallet addresses registered in the WalletRegistry. Protected by API key authentication. Supports pagination via limit and offset query parameters.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            description: "Maximum number of wallets to return.",
          },
          {
            name: "offset",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 0, default: 0 },
            description: "Number of wallets to skip for pagination.",
          },
        ],
        responses: {
          "200": {
            description: "List of registered wallet addresses",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    wallets: {
                      type: "array",
                      items: { type: "string" },
                      example: ["GAD7654...", "GCB2..."],
                    },
                    total: { type: "integer", example: 10 },
                  },
                  required: ["wallets", "total"],
                },
              },
            },
          },
          "401": { description: "Missing or invalid tenant API key" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/wallet/create": {
      post: {
        summary: "Create Seedless Wallet",
        description:
          "Provisions a sponsored Stellar account. To create an account controlled by a native client, provide ownerPublicKey; the client then initializes its multisig signer before submitting transactions.",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ownerPublicKey: {
                    type: "string",
                    description: "Stellar public key controlled by the wallet owner",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Wallet created successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    address: { type: "string", example: "GAD7654..." },
                    publicKey: { type: "string", example: "GAD7654..." },
                  },
                  required: ["address", "publicKey"],
                },
              },
            },
          },
          "401": { description: "Missing or invalid tenant API key" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/wallet/{address}/transactions": {
      get: {
        summary: "Get Wallet Transaction History",
        description:
          "Retrieves the most recent Stellar transactions for a wallet from Horizon. Results are ordered newest first and can be paginated with cursor.",
        parameters: [
          {
            name: "address",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Stellar public key address of the wallet.",
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 200, default: 20 },
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Horizon paging token from the previous response.",
          },
        ],
        responses: {
          "200": {
            description: "Wallet transaction history",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    address: { type: "string" },
                    transactions: { type: "array", items: { type: "object" } },
                    nextCursor: { type: "string", nullable: true },
                  },
                  required: ["address", "transactions", "nextCursor"],
                },
              },
            },
          },
          "400": { description: "Invalid wallet address or pagination parameter" },
          "401": { description: "Missing or invalid tenant API key" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/wallet/{address}/balance": {
      get: {
        summary: "Get Wallet Balance",
        description:
          "Retrieves the Stellar account balances for a wallet from Horizon, including native and trustline assets.",
        parameters: [
          {
            name: "address",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Stellar public key address of the wallet.",
          },
        ],
        responses: {
          "200": {
            description: "Wallet balances",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    address: { type: "string" },
                    balances: { type: "array", items: { type: "object" } },
                  },
                  required: ["address", "balances"],
                },
              },
            },
          },
          "400": { description: "Invalid wallet address" },
          "401": { description: "Missing or invalid tenant API key" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/policy": {
      get: {
        summary: "List All Policies",
        description:
          "Returns all active wallet policies configured in the policy engine. Protected by API key authentication.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "List of all configured policies",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    policies: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Policy" },
                    },
                    count: { type: "integer", example: 3 },
                  },
                  required: ["policies", "count"],
                },
              },
            },
          },
          "401": { description: "Missing or invalid tenant API key" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
      post: {
        summary: "Create or Update Wallet Policy",
        description:
          "Configures spend limit, velocity, allowlist, or blocklist policy rules for a specific wallet.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  walletId: {
                    type: "string",
                    description: "Stellar public key address of the wallet.",
                    example: "GAD7654...",
                  },
                  rules: {
                    type: "array",
                    items: {
                      oneOf: [
                        { $ref: "#/components/schemas/SpendLimitRule" },
                        { $ref: "#/components/schemas/VelocityRule" },
                        { $ref: "#/components/schemas/AllowlistRule" },
                        { $ref: "#/components/schemas/BlocklistRule" },
                        { $ref: "#/components/schemas/AssetAllowlistRule" },
                      ],
                    },
                  },
                },
                required: ["walletId", "rules"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Policy created successfully",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Policy" },
              },
            },
          },
          "401": { description: "Missing or invalid tenant API key" },
          "409": { description: "A policy already exists for this wallet" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/policy/import": {
      post: {
        summary: "Import Wallet Policy",
        description:
          "Imports a wallet policy from a JSON document previously produced by the export endpoint. " +
          "The imported rules are validated against the rule schemas before being applied.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  walletId: {
                    type: "string",
                    description: "Stellar public key address of the wallet to import the policy for.",
                    example: "GAD7654...",
                  },
                  rules: {
                    type: "array",
                    description: "Policy rules to validate and apply.",
                    items: { type: "object" },
                  },
                },
                required: ["walletId", "rules"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Policy imported successfully",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Policy" },
              },
            },
          },
          "400": { description: "Invalid or unparseable policy document" },
          "401": { description: "Missing or invalid tenant API key" },
          "422": { description: "Policy rules failed schema validation" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/policy/templates": {
      get: {
        summary: "List Policy Templates",
        description:
          "Returns the built-in named policy templates (e.g. conservative, payroll, dapp-session) that can be applied to a wallet.",
        responses: {
          "200": {
            description: "List of available policy templates",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    templates: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string", example: "conservative" },
                          description: { type: "string" },
                          rules: { type: "array", items: { type: "object" } },
                        },
                        required: ["name", "rules"],
                      },
                    },
                  },
                  required: ["templates"],
                },
              },
            },
          },
          "401": { description: "Missing or invalid tenant API key" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/policy/templates/{name}/apply": {
      post: {
        summary: "Apply Policy Template",
        description:
          "Applies a named policy template to a wallet, creating or replacing its policy. " +
          "Template rules are validated against the rule schemas before being applied.",
        parameters: [
          {
            name: "name",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Template name (e.g. conservative, payroll, dapp-session).",
            example: "conservative",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  walletId: {
                    type: "string",
                    description: "Stellar public key address of the wallet to apply the template to.",
                    example: "GAD7654...",
                  },
                },
                required: ["walletId"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Template applied successfully",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Policy" },
              },
            },
          },
          "400": { description: "Invalid request validation error" },
          "401": { description: "Missing or invalid tenant API key" },
          "404": { description: "Template not found" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/policy/{walletId}": {
      put: {
        summary: "Update Wallet Policy",
        description:
          "Replaces the rules of an existing wallet policy. Each update creates an immutable policy version.",
        parameters: [
          {
            name: "walletId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Stellar public key address of the wallet.",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  walletId: {
                    type: "string",
                    description: "Must match the walletId in the URL.",
                    example: "GAD7654...",
                  },
                  rules: {
                    type: "array",
                    items: {
                      oneOf: [
                        { $ref: "#/components/schemas/SpendLimitRule" },
                        { $ref: "#/components/schemas/VelocityRule" },
                        { $ref: "#/components/schemas/AllowlistRule" },
                        { $ref: "#/components/schemas/AssetAllowlistRule" },
                      ],
                    },
                  },
                },
                required: ["walletId", "rules"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Policy updated successfully",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Policy" },
              },
            },
          },
          "401": { description: "Missing or invalid tenant API key" },
          "404": { description: "No policy found for wallet" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
      get: {
        summary: "Get Wallet Policy",
        description: "Retrieves active policy rules for a given wallet address.",
        parameters: [
          {
            name: "walletId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Stellar public key address of the wallet.",
          },
        ],
        responses: {
          "200": {
            description: "Wallet policy details",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Policy" },
              },
            },
          },
          "401": { description: "Missing or invalid tenant API key" },
          "404": { description: "No policy found for wallet" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
      delete: {
        summary: "Delete Wallet Policy",
        description: "Deletes the wallet policy and clears its in-memory tracking data.",
        parameters: [
          {
            name: "walletId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Stellar public key address of the wallet.",
          },
        ],
        responses: {
          "204": { description: "Policy deleted successfully" },
          "401": { description: "Missing or invalid tenant API key" },
          "404": { description: "No policy found for wallet" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/policy/{walletId}/evaluate": {
      post: {
        summary: "Evaluate Transaction Against Policy (Dry Run)",
        description:
          "Evaluates a transaction envelope XDR against the stored policy for a wallet and returns the decision " +
          "and matched rule results without co-signing or recording velocity. This endpoint performs no state mutation.",
        parameters: [
          {
            name: "walletId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Stellar public key address of the wallet.",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  xdr: {
                    type: "string",
                    description: "Base64 encoded Stellar transaction envelope XDR to evaluate.",
                    example: "AAAAAG...",
                  },
                },
                required: ["xdr"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Evaluation result (no cosigning or state mutation performed)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    approved: {
                      type: "boolean",
                      description: "Whether the transaction would be approved by the policy.",
                      example: true,
                    },
                    reason: {
                      type: "string",
                      description: "Human-readable explanation of the decision.",
                      example: "Transaction approved by policy rules",
                    },
                    results: {
                      type: "array",
                      description: "Per-rule evaluation results.",
                      items: { $ref: "#/components/schemas/RuleEvaluationResult" },
                    },
                  },
                  required: ["approved", "results"],
                },
              },
            },
          },
          "400": { description: "Invalid request or malformed XDR" },
          "401": { description: "Missing or invalid tenant API key" },
          "404": { description: "No policy found for wallet" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/policy/{walletId}/export": {
      get: {
        summary: "Export Wallet Policy",
        description:
          "Exports the wallet policy as a JSON document that can be re-imported via POST /policy/import.",
        parameters: [
          {
            name: "walletId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Stellar public key address of the wallet.",
          },
        ],
        responses: {
          "200": {
            description: "Exported policy document",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletId: { type: "string", example: "GAD7654..." },
                    rules: { type: "array", items: { type: "object" } },
                    exportedAt: { type: "string", format: "date-time" },
                  },
                  required: ["walletId", "rules"],
                },
              },
            },
          },
          "401": { description: "Missing or invalid tenant API key" },
          "404": { description: "No policy found for wallet" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/policy/{id}/versions": {
      get: {
        summary: "List Policy Versions",
        description:
          "Returns the immutable version history for a policy, including the author and timestamp of each change.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Policy ID.",
          },
        ],
        responses: {
          "200": {
            description: "Policy version history",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/PolicyVersion" },
                },
              },
            },
          },
          "401": { description: "Missing or invalid tenant API key" },
          "404": { description: "Policy not found" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/policy/{id}/rollback": {
      post: {
        summary: "Rollback Policy to Version",
        description:
          "Rolls back a policy to a previously stored immutable version. The rollback itself creates a new version.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Policy ID.",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  version: {
                    type: "integer",
                    description: "Version number to roll back to.",
                    example: 2,
                  },
                },
                required: ["version"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Policy rolled back successfully",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Policy" },
              },
            },
          },
          "400": { description: "Invalid request validation error" },
          "401": { description: "Missing or invalid tenant API key" },
          "404": { description: "Policy or version not found" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/webhooks": {
      get: {
        summary: "List Webhooks",
        description: "Returns all registered webhook configurations (secrets omitted).",
        responses: {
          "200": {
            description: "List of registered webhooks",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/WebhookConfig" },
                },
              },
            },
          },
          "401": { description: "Missing or invalid tenant API key" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
      post: {
        summary: "Register Webhook",
        description: "Registers a new webhook endpoint to receive Lumen event notifications.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WebhookRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Webhook registered successfully",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebhookConfig" },
              },
            },
          },
          "400": { description: "Invalid webhook configuration" },
          "401": { description: "Missing or invalid tenant API key" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/webhooks/{id}": {
      delete: {
        summary: "Delete Webhook",
        description: "Unregisters a webhook by its ID.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Webhook ID.",
          },
        ],
        responses: {
          "204": { description: "Webhook deleted" },
          "401": { description: "Missing or invalid tenant API key" },
          "404": { description: "Webhook not found" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
      patch: {
        summary: "Update Webhook",
        description:
          "Partially updates a webhook — toggle enabled state or change the subscribed event list. " +
          "At least one field must be provided. The webhook ID and secret cannot be changed.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Webhook ID.",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: {
                    type: "string",
                    format: "uri",
                    description: "New destination URL.",
                    example: "https://example.com/webhook",
                  },
                  events: {
                    type: "array",
                    items: { type: "string" },
                    description: "Replacement event subscription list.",
                    example: ["transaction.cosigned", "wallet.created"],
                  },
                  enabled: {
                    type: "boolean",
                    description: "Set to false to pause delivery without deleting the webhook.",
                    example: false,
                  },
                },
                minProperties: 1,
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Webhook updated successfully",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebhookConfig" },
              },
            },
          },
          "400": { description: "Invalid patch payload" },
          "401": { description: "Missing or invalid tenant API key" },
          "404": { description: "Webhook not found" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/webhooks/{id}/test": {
      post: {
        summary: "Send Test Webhook",
        description:
          "Dispatches a synthetic `test.ping` event to the registered webhook URL. " +
          "Useful for verifying endpoint reachability and signature validation without " +
          "triggering real on-chain activity.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Webhook ID.",
          },
        ],
        responses: {
          "200": {
            description: "Test delivery attempted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: {
                      type: "boolean",
                      description: "Whether the remote server returned a 2xx response.",
                      example: true,
                    },
                    statusCode: {
                      type: "integer",
                      nullable: true,
                      description: "HTTP status code returned by the remote server.",
                      example: 200,
                    },
                    attempts: {
                      type: "integer",
                      description: "Always 1 for test deliveries.",
                      example: 1,
                    },
                    responseTimeMs: {
                      type: "integer",
                      description: "Round-trip time in milliseconds.",
                      example: 142,
                    },
                  },
                  required: ["success", "statusCode", "attempts", "responseTimeMs"],
                },
              },
            },
          },
          "401": { description: "Missing or invalid tenant API key" },
          "404": { description: "Webhook not found" },
          "429": { $ref: "#/components/responses/QuotaExceeded" },
        },
      },
    },
    "/webhooks/{id}/deliveries": {
      get: {
        summary: "List Webhook Deliveries",
        description:
          "Returns the delivery history for a webhook, including pending retries and deliveries routed to the dead-letter queue (DLQ).",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Webhook ID.",
          },
          {
            name: