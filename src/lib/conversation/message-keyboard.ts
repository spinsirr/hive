export type MessageKeyEvent = {
  key: string;
  shiftKey: boolean;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
  };
};

export function shouldSubmitMessage(event: MessageKeyEvent) {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.nativeEvent?.isComposing &&
    event.nativeEvent?.keyCode !== 229
  );
}
