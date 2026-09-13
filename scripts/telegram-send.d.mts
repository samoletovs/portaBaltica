export declare function splitTelegramMessage(text: string): string[];

export declare function sendTelegramMessage(
  text: string,
  options: { token: string; chatId: string; fetchImpl?: typeof fetch },
): Promise<number>;
