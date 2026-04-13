# TNAS Risk Scoring Methodology

The TNAS (Telegram Network Analysis System) calculates a Risk Score for each channel. The score is a normalized value ranging from **0 to 100**. It is calculated as a weighted sum of four main criteria. 

Here is the breakdown of the criteria and how they factor into the calculation:

## 1. Keyword Score (35% Weight)
This measures how often pre-defined "risk keywords" appear in a channel's messages.
* **Calculation**: For each message, it counts the occurrences of flagged keywords, applying a specific weight to each keyword. The total weighted sum is divided by the number of messages to find an average, and then normalized onto a 0-25 scale.

## 2. Link Score (25% Weight)
This assesses the volume of outgoing links and checks if they direct users towards automated bots or potentially harmful channels. 
* **Calculation**: It looks at both the total number of unique outgoing links in a channel's messages and specifically how many of those links point towards known "bots". 

## 3. Centrality Score (25% Weight)
This evaluates the channel's structural importance within the discovered Telegram network (a proxy for influence).
* **Calculation**: It uses the **PageRank** graph algorithm based on the channel's connections. The rank is normalized relative to the most central node in the entire graph.

## 4. Repost Score (15% Weight)
This estimates how frequently and broadly this channel's content spreads across the network.
* **Calculation**: It combines the total number of times the channel's messages were forwarded (`forward_count` metadata from Telegram) and the graph `in_degree` (the number of other channels linking/forwarding back to it).

---

## Final Score & Labeling
Each of the 4 components contributes a maximum of 25 points raw, but they are adjusted by their respective config weights (35%, 25%, 25%, 15%) and combined into a final score from 0 to 100.

Based on the final score, the channel is assigned a **Risk Label**:
* **CRITICAL**: 75 - 100
* **HIGH**: 50 - 74
* **MEDIUM**: 25 - 49
* **LOW**: 1 - 24
* **UNKNOWN**: 0
