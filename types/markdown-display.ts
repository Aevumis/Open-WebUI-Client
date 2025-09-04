// Minimal type declarations for react-native-markdown-display
// to satisfy TS in this project. Adjust as needed.

declare module 'react-native-markdown-display' {
  import type { ComponentType, ReactNode } from 'react';
  import type { TextStyle, ViewStyle } from 'react-native';

  export type MarkdownStyle = Partial<Record<
    | 'body'
    | 'heading1'
    | 'heading2'
    | 'heading3'
    | 'heading4'
    | 'heading5'
    | 'heading6'
    | 'code_inline'
    | 'code_block'
    | 'blockquote'
    | 'em'
    | 'strong'
    | 'hr'
    | 'link'
    | 'list_item'
    | 'bullet_list'
    | 'ordered_list',
    TextStyle | ViewStyle
  >>;

  export type MarkdownProps = {
    children?: ReactNode;
    style?: MarkdownStyle;
    rules?: any;
    onLinkPress?: (url?: string) => boolean | void;
    markdownit?: any;
    debugPrintTree?: boolean;
  };

  const Markdown: ComponentType<MarkdownProps>;
  export default Markdown;
}
