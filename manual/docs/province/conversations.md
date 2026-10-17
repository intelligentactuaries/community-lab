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
sings: the inspector shows the hymn's number and title and how many in the pews are singing, the transcript gives
the hymn's lines to *The congregation*, and every voice on the map carries a ♪.

## Having a model script it

A conversation starts with **procedural chatter**: short lines from the simulation's own repertoire. Press **Script
with AI** on the conversation (in the inspector, while it is still going on) and a language model writes it instead,
from what the simulation knows:

- the setting: the place, the time, the season, the weather, a holiday;
- each speaker: their age, sex, job, schooling, personality, mood and stress, faith, family, money, health, grief,
  a pregnancy, and the last few events of their life;
- their relationship, and what has happened in the province in the last ten days;
- the lines already said.

The model is asked for a short exchange in the speakers' voices: six lines, or four for one speaker, each under
25 words (South African English is fine). Its lines take the place of the procedural ones, appear at a speaking
pace in simulated time, and the conversation lasts until the last line has been said. The conversation's *Status*
reads *asking the model…*, *model is writing…* and then *scripted by the model*.

Scripts are **cached** per prompt, seed, conversation and model, so replaying a seed costs nothing. **clear
dialogue cache**, at the foot of Settings, empties the cache.

## Dialogue modes

Set in **Settings › Dialogue**, and shown on the model chip in the top bar:

| Mode | What happens |
|---|---|
| **Off (procedural chatter)** | No model is asked; every line is procedural, and **Script with AI** is not offered. |
| **On demand** (the default) | A conversation is scripted when you press **Script with AI**. |
| **Automatic when zoomed in** | While the clock runs at an animated speed and you are zoomed in close, each conversation that comes into view is scripted, one at a time, so a local model keeps up. |

## Talking to a resident

Select a person and open the inspector: the **Talk to …** card is at the foot of their page, for anyone alive and
still in the province. Type a question and press **ask** (or <kbd>Enter</kbd>). They answer **in character, from
the simulation's state only**: their own card, today's date and weather, the news of the last thirty days, and what
you have said so far. The reply streams in as it is written. This needs a model, whatever the dialogue mode, and
replies are never cached. Selecting someone else starts a new conversation.

## Choosing a model

The model chip opens **Settings**, where *Provider* chooses who serves the dialogue:

| Provider | What it needs |
|---|---|
| **auto** (the default) | Ollama if it has a model, otherwise the first hosted provider with a key (or the compatible endpoint, once it has a base URL). |
| **Ollama (local)** | [Ollama](https://ollama.com) running on this machine. The app picks the first installed model of the gpt-oss, Gemma, Qwen (3 or 2.5) or Llama 3 families, otherwise the first model installed, or the one you choose. For gpt-oss, *reasoning* low is fastest. |
| **Anthropic Claude**, **OpenAI**, **Google Gemini** | An API key. Name a model, or leave the field empty for the default: `claude-haiku-5-5`, `gpt-4o-mini` or `gemini-3.8-flash`. |
| **OpenAI-compatible endpoint** | A base URL (LM Studio, vLLM, Groq…), a model id and, if it needs one, a key. |

Keys are saved in the app's own storage on this machine (the desktop app keeps it on disk, in its profile) and
handed to the engine, which holds them in memory; they go nowhere else but the provider. Press **save** after
changing a provider or a key. The *Serve dialogue with* row says which provider and model are in use now.

In the desktop IDE the local model loads when the first conversation needs it, not when the app starts, and stays
loaded for half an hour after its last use; a 20b model holds about 7 GB of the GPU's memory. If Ollama was started
after the app, press **refresh** in Settings.

## Without a model

Nothing in the simulation depends on one. Without a model, **Script with AI** falls back to procedural chatter and
says so (*model failed — showing chatter*), the model chip reads *no model*, and Talk to … shows the reason under
the chat.
