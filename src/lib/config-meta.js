export const CONFIG_SECTIONS = [
    {
        id: "identity",
        title: "Band Identity",
        intro: "This is the bit that makes the app feel like yours instead of a suspiciously generic band gadget.",
        fields: [
            {
                path: "bandName",
                label: "Band name",
                type: "text",
                description: "Changes the app title to '[band name] Setlist Generator'."
            }
        ]
    },
    {
        id: "generator",
        title: "Generator Defaults",
        intro: "These are the polite suggestions the generator starts with before your presets bully it around.",
        fields: [
            {
                path: "general.count",
                label: "Default song count",
                type: "number",
                min: 1,
                max: 60,
                description: "How many songs the generator should aim for when no preset overrides it."
            },
            {
                path: "general.beamWidth",
                label: "Beam width",
                type: "number",
                min: 1,
                max: 2048,
                description: "How many candidate setlists stay alive during search. Higher means smarter but slower."
            },
            {
                path: "general.limits.covers",
                label: "Default max covers",
                type: "number",
                min: 0,
                max: 20,
                description: "Default cap on cover songs in a generated set."
            },
            {
                path: "general.limits.instrumentals",
                label: "Default max instrumentals",
                type: "number",
                min: 0,
                max: 20,
                description: "Default cap on instrumentals in a generated set."
            }
        ]
    },
    {
        id: "weights",
        title: "Scoring Weights",
        intro: "Bigger numbers mean the generator winces harder when that thing happens.",
        fields: [
            {
                path: "general.weighting.tuning",
                label: "Tuning change cost",
                type: "number",
                min: 0,
                max: 50,
                description: "Penalty for changing tuning between songs."
            },
            {
                path: "general.weighting.capo",
                label: "Capo movement cost",
                type: "number",
                min: 0,
                max: 50,
                description: "Penalty per capo step between songs."
            },
            {
                path: "general.weighting.instrument",
                label: "Instrument swap cost",
                type: "number",
                min: 0,
                max: 50,
                description: "Penalty for switching instruments between songs."
            },
            {
                path: "general.weighting.picking",
                label: "Picking change cost",
                type: "number",
                min: 0,
                max: 50,
                description: "Penalty for flipping between picked and not-picked setups."
            },
            {
                path: "general.weighting.positionMiss",
                label: "Position miss cost",
                type: "number",
                min: 0,
                max: 50,
                description: "Penalty when a song ignores the opener/closer slot rules."
            },
            {
                path: "general.weighting.energyTarget",
                label: "Energy target cost",
                type: "number",
                min: 0,
                max: 50,
                description: "Penalty for landing far from the target energy curve."
            },
            {
                path: "general.weighting.repeatEnergy",
                label: "Repeat energy cost",
                type: "number",
                min: 0,
                max: 50,
                description: "Penalty for repeating the same energy level back-to-back."
            },
            {
                path: "general.weighting.energyStreak",
                label: "Energy streak cost",
                type: "number",
                min: 0,
                max: 50,
                description: "Extra penalty when the same energy level just keeps happening."
            },
            {
                path: "general.weighting.bigEnergyJump",
                label: "Big energy jump cost",
                type: "number",
                min: 0,
                max: 50,
                description: "Penalty for jumping more than one energy level between songs."
            },
            {
                path: "general.weighting.earlyCover",
                label: "Early cover cost",
                type: "number",
                min: 0,
                max: 50,
                description: "Penalty for sneaking a cover into the opener slots."
            },
            {
                path: "general.weighting.earlyInstrumental",
                label: "Early instrumental cost",
                type: "number",
                min: 0,
                max: 50,
                description: "Penalty for opening too early with an instrumental."
            }
        ]
    },
    {
        id: "randomness",
        title: "Chaos Knobs",
        intro: "This is where you decide whether the generator is a thoughtful bandmate or a mildly caffeinated raccoon.",
        fields: [
            {
                path: "general.randomness.variantJitter",
                label: "Variant jitter",
                type: "number",
                min: 0,
                max: 10,
                step: 0.1,
                description: "Small randomness when choosing among different playable variants of the same song."
            },
            {
                path: "general.randomness.stateJitter",
                label: "State jitter",
                type: "number",
                min: 0,
                max: 10,
                step: 0.1,
                description: "Small randomness applied to candidate setlists during search."
            },
            {
                path: "general.randomness.finalChoicePool",
                label: "Final choice pool",
                type: "number",
                min: 1,
                max: 100,
                description: "How many strong final candidates are kept before one is chosen."
            },
            {
                path: "general.randomness.temperature",
                label: "Final temperature",
                type: "number",
                min: 0.01,
                max: 10,
                step: 0.05,
                description: "Higher values make the final choice wander further from the absolute lowest score."
            },
            {
                path: "general.randomness.shuffleCatalog",
                label: "Shuffle catalog",
                type: "boolean",
                description: "Randomizes the song exploration order before search starts."
            },
            {
                path: "general.randomness.songBias",
                label: "Song bias spread",
                type: "number",
                min: 0,
                max: 20,
                step: 0.1,
                description: "Assigns each song a small run-specific bias so the same favorites do not dominate every time."
            },
            {
                path: "general.randomness.beamChoicePoolMultiplier",
                label: "Beam pool multiplier",
                type: "number",
                min: 1,
                max: 20,
                description: "How wide the candidate pool gets before beam pruning picks survivors."
            },
            {
                path: "general.randomness.beamTemperature",
                label: "Beam temperature",
                type: "number",
                min: 0.01,
                max: 10,
                step: 0.05,
                description: "Higher values keep more eccentric candidate branches alive during the search."
            },
            {
                path: "general.randomness.maxStatesPerLastSong",
                label: "Max states per last song",
                type: "number",
                min: 1,
                max: 200,
                description: "Stops the beam from filling up with ten near-identical branches ending on the same song."
            },
            {
                path: "general.randomness.blockShuffleTemperature",
                label: "Block shuffle temperature",
                type: "number",
                min: 0.01,
                max: 10,
                step: 0.05,
                description: "How freely the generator shuffles songs inside the same compatible setup block."
            }
        ]
    },
    {
        id: "props",
        title: "Transition Rules",
        intro: "These tell the generator when a change is fine, when it should wait a few songs, and when it should stop being dramatic.",
        fields: [
            {
                path: "props.tuning.minStreak",
                label: "Tuning min streak",
                type: "number",
                min: 0,
                max: 20,
                description: "Minimum number of songs to stay in a tuning setup before changing again."
            },
            {
                path: "props.tuning.allowChangeOnLastSong",
                label: "Tuning can change on last song",
                type: "boolean",
                description: "Lets the closer break the streak rule for tuning changes."
            },
            {
                path: "props.capo.minStreak",
                label: "Capo min streak",
                type: "number",
                min: 0,
                max: 20,
                description: "Minimum number of songs to keep capo positions steady before changing them."
            },
            {
                path: "props.capo.allowChangeOnLastSong",
                label: "Capo can change on last song",
                type: "boolean",
                description: "Lets the final song ignore the usual capo streak rule."
            },
            {
                path: "props.instruments.minStreak",
                label: "Instrument min streak",
                type: "number",
                min: 0,
                max: 20,
                description: "Minimum number of songs before another instrument swap is allowed."
            },
            {
                path: "props.instruments.allowChangeOnLastSong",
                label: "Instrument swap on last song",
                type: "boolean",
                description: "Lets the closer change instruments even if the streak is short."
            },
            {
                path: "props.picking.minStreak",
                label: "Picking min streak",
                type: "number",
                min: 0,
                max: 20,
                description: "Minimum number of songs before another picking-style change is allowed."
            },
            {
                path: "props.picking.allowChangeOnLastSong",
                label: "Picking can change on last song",
                type: "boolean",
                description: "Lets the final song ignore the picking streak rule."
            }
        ]
    }
];


export const CONFIG_REFERENCE = CONFIG_SECTIONS.flatMap((section) => {
    return section.fields.map((field) => ({
        section: section.title,
        ...field
    }));
});
