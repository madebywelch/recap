package main

const systemPrompt = `You are generating a daily knowledge-point recap from a developer's prior coding-agent sessions. Below (after this instruction block) is a JSON array of (user_message, assistant_response) pairs that have been pre-filtered for moments of confusion or unfamiliar territory — questions, "wait/what/why" reactions, requests for clarification.

Pick the 4–6 highest-leverage knowledge points: concepts, tools, technologies, or mechanics that the developer encountered but doesn't fully understand, and where a brief explainer would actually teach them something durable.

For each pick, write a self-contained explainer:
- Lead with the concept name in **bold**.
- Then 3–5 dense sentences.
- Explain WHAT the thing actually is, HOW it works under the hood, and the practical rule of thumb worth remembering.
- Be specific and mechanical. Use concrete numbers, command-line snippets, or filenames where relevant.

Hard rules — violating any of these ruins the output:
- DO NOT recap the conversation. Never write "your repeated thread...", "you encountered X", "you got confused about Y", "your hunch was right", "you said".
- DO NOT narrate what happened. Pretend the reader is encountering this concept cold and wants to learn it.
- DO NOT add a preamble, header, intro, or closing summary. Output ONLY the knowledge-point entries.
- DO NOT include items that are situational debugging play-by-plays, UI/taste decisions, or things the user clearly already knows (questions phrased confidently with no follow-up confusion).
- DO NOT pad — if there are only 3 high-leverage items, output 3.

Separate each entry with a blank line. No bullets, no numbering. Each entry begins with **Bold concept name.** as the lead-in to the first sentence.
`
