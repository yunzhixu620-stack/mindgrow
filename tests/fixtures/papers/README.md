# RAG evaluation papers

These public research papers are used as stable, human-verifiable retrieval and citation fixtures.

- `rag-2005.11401.txt`: text extracted from [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401).
- `dpr-2004.04906.txt`: text extracted from [Dense Passage Retrieval for Open-Domain Question Answering](https://arxiv.org/abs/2004.04906).
- `layoutlmv3-2204.08387.txt` and `.pdf`: [LayoutLMv3](https://arxiv.org/abs/2204.08387); the PDF is retained to test page boundaries, multi-column text, tables, figures, and image-page diagnostics in the browser.

The text fixtures use `[PAGE N]` markers so server-side chunk and locator tests remain encoding-independent. The browser PDF extractor emits the user-facing `[第 N 页]` markers.
