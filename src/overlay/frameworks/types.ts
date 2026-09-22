import type { ComponentInfo, ElementInfo } from '../../core/types.js';

export type { ComponentInfo };

export interface FrameworkAdapter {
  key: keyof Pick<ElementInfo, 'react' | 'vue'>;
  detect(el: Element, root?: string): ComponentInfo | undefined;
}
