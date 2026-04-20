/** Minimal types for Google Identity Services OAuth2 token client (step-up flows). */
export {};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (tokenResponse: {
              access_token?: string;
              error?: string;
              error_description?: string;
            }) => void;
          }): {
            requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
          };
        };
      };
    };
  }
}
