import type { AIMindMap } from "@/types";

export interface SelectedMindMapChild {
  childIdx: number;
  items: string[];
}

export function buildSelectedMindMap(
  mindMap: AIMindMap,
  selectedChildren: SelectedMindMapChild[],
): AIMindMap {
  return {
    root: mindMap.root,
    rootDesc: mindMap.rootDesc,
    rootType: mindMap.rootType,
    rootCitationIndexes: mindMap.rootCitationIndexes,
    children: selectedChildren.map((selection) => {
      const child = mindMap.children[selection.childIdx];
      const selectedIndexes = selection.items.map((item) => child.items.indexOf(item));
      return {
        topic: child.topic,
        desc: child.desc,
        type: child.type,
        items: selection.items,
        citationIndexes: child.citationIndexes,
        itemCitationIndexes: selectedIndexes.map((index) => (
          index >= 0 ? child.itemCitationIndexes?.[index] || [] : []
        )),
      };
    }),
    relatedTopics: mindMap.relatedTopics,
  };
}
