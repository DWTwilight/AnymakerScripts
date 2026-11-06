# Golf GTI MK8 Scripting Context

## Doors and Locks

### Databus Inputs (Out Variables)

- FL_Door_Handle.is_active
  - Boolean
  - true means the front-left door handle is opened
- FR_Door_Handle.is_active
  - Boolean
  - true means the front-right door handle is opened
- RL_Door_Handle.is_active
  - Boolean
  - true means the rear-left door handle is opened
- RR_Door_Handle.is_active
  - Boolean
  - true means the rear-right door handle is opened
- Trunk_Handle.is_active
  - Boolean
  - true means the trunk handle is opened
- Hood_Handle.is_active
  - Boolean
  - true means the hood handle is opened
- Door_Lock.is_pressed
  - Boolean
  - true means door lock is pressed

### Databus Outputs (In Variables)

- ASM_FL_Door_Latch.input
  - Fractional
  - 0.0 means closed, 1.0 means open
- ASM_FR_Door_Latch.input
  - Fractional
  - 0.0 means closed, 1.0 means open
- ASM_RL_Door_Latch.input
  - Fractional
  - 0.0 means closed, 1.0 means open
- ASM_RR_Door_Latch.input
  - Fractional
  - 0.0 means closed, 1.0 means open
- ASM_Trunk_Latch.input
  - Fractional
  - 0.0 means closed, 1.0 means open
- ASM_Hood_Latch.input
  - Fractional
  - 0.0 means closed, 1.0 means open

### Logic

Latch is open if handle is active and not locked

## Power & Lights

### Databus Inputs (Out Variables)

- Btn_Start_Stop.is_pressed
  - Boolean
  - whther Start/Stop button is pressed
- Steering_Wheel.left_pedal
  - Fractional
  - Break input, 0(no break) -> 1(full break)

### Databus Outputs (In Variables)

- Btn_Start_Stop.is_illuminated
  - Boolean
  - backlight on/off
- Dial_RPM.is_illuminated
  - Boolean
  - backlight on/off
- Dial_Speed.is_illuminated
  - Boolean
  - backlight on/off
- Display_Gear.is_illuminated
  - Boolean
  - backlight on/off
- ASM_Power_Main.input
  - Fractional
  - Main Power Relay(1 -> on)
- ASM_Power_Engine.input.input
  - Fractional
  - Engine Power Relay(1 -> on)

### Logic

For this part, a global state var is needed:

```txt
Power_State

0 -> off
1 -> Main Power On, turn on ASM_Power_Main
2 -> Engine Start (and Main Power On), trun on ASM_Power_Main & ASM_Power_Engine
```

- If Start/Stop Button is pressed
  - if current state is 0
    - If break input > 0.5, 0 -> 2
    - If no break (<= 0.5), 0 -> 1
  - if current state is 1
    - If break input > 0.5, 1 -> 2
    - If no break (<= 0.5), 1 -> 0
  - if current state is 2, 2 -> 0

## Engine

### Databus Inputs (Out Variables)

- Engine.rps
  - Fractional
  - the engine starts at 6 rps (360 RPM)
- Steering_Wheel.right_pedal
  - Fractional
  - Throttle input, 0(no Throttle) -> 1(full Throttle)

### Databus Outputs (In Variables)

- ASM_Power_Starter.input
  - Fractional
  - Engine Starter Power Relay(1 -> on)
- ASM_Throttle.input
  - Fractional
  - Actual Engine Throttle Input, 0(no Throttle) -> 1(full Throttle)

### Logic

Global state:

```txt
Power_State         # from Power & Lights

IDLE_RPS = 13.5
STARTER_CUTOFF_RPS = 6.5
MIN_IDLE_THROTTLE = 0.05
```

- If `Power_State` is not 2:
  - set `ASM_Power_Starter.input` -> 0.0
  - set `ASM_Throttle.input` -> 0.0
- else `Power_State` is 2:
  - Starter Logic:
    - set `ASM_Power_Starter.input` -> 1.0 if `Engine.rps < STARTER_CUTOFF_RPS`, else 0.0
    - no latch needed: once RPS reaches 6.5 the starter cuts, and the throttle below stays at 1.0 until RPS > 8.5, so the engine keeps accelerating instead of chattering
  - Throttle Logic (always evaluated while `Power_State` is 2):
    1. calculate minimal throttle to keep idle (anti-stall), constant global `IDLE_RPS` (13.5)
       - `minimalThrottle = (IDLE_RPS - Engine.rps) * 0.2`
       - clamp `minimalThrottle` to `[MIN_IDLE_THROTTLE, 1.0]`
       - this is 1.0 for all `Engine.rps <= 8.5`, so cranking naturally gets full throttle
    2. apply pedal input:
       - `engineThrottle = minimalThrottle + (1.0 - minimalThrottle) * pedalInput`
       - clamp `engineThrottle` to `[MIN_IDLE_THROTTLE, 1.0]`
    3. set `ASM_Throttle.input` -> `engineThrottle`