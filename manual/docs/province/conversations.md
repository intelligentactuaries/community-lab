# Conversations

Residents talk: at home, at work, in the street, in the churchyard after the service. Every conversation is a
real event in the simulation, between two or more people the simulation brought together, with a tone (warm,
neutral, tense, grief, joy, gossip, prayer) and a topic. What they *say* is written either procedurally or, if you
ask, by a language model that knows who they are.

## Watching one

Conversations happen in the **animated** day, at speeds up to an hour a second; switching to a time-lapse speed
ends them. On the map, two people talking are joined by a **dashed line** (red when the exchange is tense), and
close up their latest line appears in a **speech bubble**.

**Click one of the speakers**, close up, to select the conversation: the inspector shows who is in it, where, its
tone and topic, its status, and the **transcript** line by line with the time. The inspector's front page, with
nothing selected, lists the live conversations too.

During a Sunday service the pastor preaches as one long conversation, and when he calls a hymn the congregation
sings: the transcript gives the hymn's lines to *The congregation*, and every voice on the map carries a ♪.

## Having a model script it

A conversation starts with **procedural chatter**: short lines from the simulation's own repertoire. Press **Script
with AI** on the conversation and a language model writes it instead, from what the simulation knows:

- the setting: the place, the time, the season, the weather, a holiday;
- each speaker: their age, sex, job, schooling, personality, mood and stress, faith, family, money, health, grief,
  a pregnancy, and the last few events of their life;
- their relationship, and what has happened in the province in the last ten days;
- the lines already said.

The model is asked for a short exchange in the speakers' voices (South African English is fine). The lines appear
at a speaking pace in simulated time, and the conversation lasts until the last line has been said.

Scripts are **cached** per seed, conversation and model, so replaying a seed costs nothing. **Settings › clear
dialogue cache** empties the cache.

## Dialogue modes

Set in **Settings › Dialogue**, and shown on the model chip in the top bar:

| Mode | What happens |
|---|---|
| **Off (procedural chatter)** | No model is asked; every line is procedural. |
| **On demand** (the default) | A conversation is scripted when you press **Script with AI**. |
| **Automatic when zoomed in** | While the clock runs at an animated speed and you are zoomed in close, the conversation in view is scripted, one at a time, so a local model keeps up. |

## Talking to a resident

Select a person and press **Talk to …** in the inspector. Ask them anything; they answer **in character, from the
simulation's state only**: their own card, today's date and weather, the news of the last thirty days, and what you
have said so far. This needs a model, whatever the dialogue mode, and replies are never cached.

## Choosing a model

The model chip opens **Settings**, where *Provider* chooses who serves the dialogue:

| Provider | What it needs |
|---|---|
| **auto** (the default) | Ollama if it has a model, otherwise the first hosted provider with a key. |
| **Ollama (local)** | [Ollama](https://ollama.com) running on this machine. The app picks the first installed model of the gpt-oss, Gemma, Qwen or Llama families, or the one you choose. For gpt-oss, *reasoning* low is fastest. |
| **Anthropic Claude**, **OpenAI**, **Google Gemini** | An API key; the model is yours to choose. |
| **OpenAI-compatible endpoint** | A base URL (LM Studio, vLLM, Groq…) and, if it needs one, a key. |

Keys are kept in the app's own storage on this machine and handed to the engine, which holds them in memory; they
go nowhere else but the provider. Press **save** after changing a provider or a key.

The local model loads when the first conversation needs it, not when the app starts, and stays loaded for half an
hour after its last use; a 20b model holds about 7 GB of the GPU's memory. If Ollama was started after the app,
press **refresh** in Settings.

## Without a model

Nothing in the simulation depends on one. Without a model, **Script with AI** falls back to procedural chatter and
says so (*model failed — showing chatter*), the model chip reads *no model*, and Talk to … shows the reason under
the chat.
