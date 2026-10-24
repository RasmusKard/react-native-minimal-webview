# Type Alias: SettingsRoot\<Keys\>

> **SettingsRoot**\<`Keys`\> = `Keys` & `Record`\<`string`, [`SettingValue`](SettingValue.md) \| `undefined`\>

A settings root: its generated keys ([IOSSettingKeys](IOSSettingKeys.md), [AndroidSettingKeys](AndroidSettingKeys.md), from the SDK headers) plus,
untyped, any other key the platform has.

## Type Parameters

### Keys

`Keys`
