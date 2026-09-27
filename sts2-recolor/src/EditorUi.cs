using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Godot;
using MegaCrit.Sts2.Core.Models;
using MegaCrit.Sts2.Core.Nodes.Combat;
using MegaCrit.Sts2.Core.Rooms;

namespace SpireRecolor;

/// <summary>
/// The F8 palette editor. Built entirely from stock Godot controls wired with C# events
/// (no custom Node subclasses, which mod assemblies can't register as scripts).
/// </summary>
internal static class EditorUi
{
	private sealed class Entry
	{
		public string Key = "";
		public string Label = "";
		public string Group = "";
		public Func<Node>? Create;          // a combat creature (NCreatureVisuals) or, for Ancients, their event scene
		public MonsterModel? Monster;
		public int ItemIndex;
	}

	private static CanvasLayer? _layer;
	private static readonly List<Entry> _entries = new();
	private static Entry? _current;
	private static bool _suppress;

	private static OptionButton _target = null!;
	private static OptionButton _part = null!;
	private static Label _settingsHeader = null!;
	private static readonly List<string> _partNames = new();
	private static string? _currentPart;
	private static int _highlightFrames;
	private static CheckBox _enabled = null!;
	private static CheckBox _showOriginal = null!;
	private static HSlider _hue = null!, _sat = null!, _bright = null!, _contrast = null!, _tintAmt = null!;
	private static HSlider _picAmt = null!, _picScale = null!;
	private static OptionButton _picMode = null!;
	private static Label _picName = null!;
	private static ColorPickerButton _tint = null!;
	private static VBoxContainer _swapList = null!;
	private static Label _status = null!;
	private static SubViewportContainer _vpContainer = null!;
	private static SubViewport _vp = null!;
	private static Node2D _holder = null!;
	private static ulong _fitFor;       // preview the framing below was measured for
	private static Rect2? _fitRect;     // whole-skeleton outline, grown over the animation
	private static Node? _preview;

	// The Spine body inside whatever the preview shows (a creature's Body, or the first SpineSprite in a scene).
	private static Node? PreviewBody => _preview is NCreatureVisuals v ? v.Body : (_preview != null && GodotObject.IsInstanceValid(_preview) ? Recolorer.FindSpine(_preview) : null);
	private static int _previewAge;

	private static int _pickSwap = -1;
	// What the eyedropper fills: a swap's "from" (original colors), a swap's "to" or the tint (colors as you see them).
	private enum PickWhat { SwapFrom, SwapTo, Tint }
	private static PickWhat _pickWhat = PickWhat.SwapFrom;
	// Click-to-select: frames left before reading the ID pass (0 = idle).
	private static int _selectFrames;
	private static Vector2 _selectPos;
	private static bool _pickArmed;
	private static int _pickFrames;
	private static Vector2 _pickPos;

	private static double _saveAt = -1;

	public static bool IsOpen => _layer != null && GodotObject.IsInstanceValid(_layer) && _layer.Visible;

	public static void Toggle()
	{
		if (IsOpen)
		{
			Close();
			return;
		}
		if (_layer == null || !GodotObject.IsInstanceValid(_layer))
			Build();
		_layer!.Visible = true;
		SelectEntry(_current ?? _entries.FirstOrDefault());
	}

	public static void SelectByKey(string key)
	{
		if (!IsOpen)
			Toggle();
		var e = _entries.FirstOrDefault(x => x.Key == key && x.Create != null);
		if (e == null)
			throw new ArgumentException("unknown target " + key);
		SelectEntry(e);
	}

	/// <summary>Re-read controls after the palette was changed from outside the UI.</summary>
	public static void Reload()
	{
		if (_layer == null || !GodotObject.IsInstanceValid(_layer))
			return;
		LoadControls();
		RebuildSwaps();
		RefreshTargetLabels();
		RefreshModelSection();
	}

	private static void Close()
	{
		if (_layer == null)
			return;
		_layer.Visible = false;
		ClearPreview();
		_pickSwap = -1;
		_pickArmed = false;
		FlushSave();
	}

	private static double Now => Time.GetTicksMsec() / 1000.0;

	// ---------------------------------------------------------------- per-frame

	public static void Tick()
	{
		if (_saveAt > 0 && Now >= _saveAt)
			FlushSave();
		if (!IsOpen)
			return;

		if (_preview != null && GodotObject.IsInstanceValid(_preview))
		{
			_previewAge++;
			if (_previewAge == 2)
			{
				StartPreviewAnimation();
				PopulateParts();
			}
			FitPreview();
		}

		if (_highlightFrames > 0 && --_highlightFrames == 0)
		{
			Recolorer.Highlight = null;
			Palette.Touch();
		}

		if (_pickFrames > 0 && --_pickFrames == 0)
			FinishPick();
		if (_selectFrames > 0 && --_selectFrames == 0)
			FinishSelect();
	}

	private static void FlushSave()
	{
		if (_saveAt < 0)
			return;
		_saveAt = -1;
		Palette.Save();
	}

	private static void Changed()
	{
		Palette.Touch();
		_saveAt = Now + 0.6;
		RefreshTargetLabels();
		RefreshPartLabels();
	}

	// ---------------------------------------------------------------- build

	private static void Build()
	{
		BuildEntries();

		var tree = (SceneTree)Engine.GetMainLoop();
		_layer = new CanvasLayer { Layer = 120, Name = "SpireRecolorEditor" };
		tree.Root.AddChild(_layer);

		var root = new Control { MouseFilter = Control.MouseFilterEnum.Stop };
		root.SetAnchorsPreset(Control.LayoutPreset.FullRect);
		root.Theme = new Theme { DefaultFontSize = 17 };
		_layer.AddChild(root);

		var dim = new ColorRect { Color = new Color(0.03f, 0.02f, 0.06f, 0.72f), MouseFilter = Control.MouseFilterEnum.Ignore };
		dim.SetAnchorsPreset(Control.LayoutPreset.FullRect);
		root.AddChild(dim);

		var margin = new MarginContainer();
		margin.SetAnchorsPreset(Control.LayoutPreset.FullRect);
		foreach (var side in new[] { "left", "right", "top", "bottom" })
			margin.AddThemeConstantOverride("margin_" + side, 28);
		root.AddChild(margin);

		var hbox = new HBoxContainer();
		hbox.AddThemeConstantOverride("separation", 20);
		margin.AddChild(hbox);

		// --- preview (left)
		var previewPanel = new PanelContainer { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
		previewPanel.AddThemeStyleboxOverride("panel", Box(new Color(0.09f, 0.07f, 0.14f, 0.95f), new Color(0.55f, 0.4f, 0.9f)));
		hbox.AddChild(previewPanel);
		var pv = new VBoxContainer();
		previewPanel.AddChild(pv);
		pv.AddChild(new Label { Text = "  Live preview", Modulate = new Color(0.8f, 0.75f, 1f) });
		_vpContainer = new SubViewportContainer { Stretch = true, SizeFlagsVertical = Control.SizeFlags.ExpandFill, SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, MouseFilter = Control.MouseFilterEnum.Stop };
		_vpContainer.GuiInput += OnPreviewInput;
		pv.AddChild(_vpContainer);
		_vp = new SubViewport { TransparentBg = true, HandleInputLocally = false, RenderTargetUpdateMode = SubViewport.UpdateMode.Always };
		_vpContainer.AddChild(_vp);
		_holder = new Node2D();
		_vp.AddChild(_holder);

		// --- controls (right)
		var panel = new PanelContainer { CustomMinimumSize = new Vector2(560, 0) };
		panel.AddThemeStyleboxOverride("panel", Box(new Color(0.07f, 0.05f, 0.11f, 0.97f), new Color(0.85f, 0.7f, 0.3f)));
		hbox.AddChild(panel);
		var scroll = new ScrollContainer { HorizontalScrollMode = ScrollContainer.ScrollMode.Disabled };
		panel.AddChild(scroll);
		var col = new VBoxContainer { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
		col.AddThemeConstantOverride("separation", 8);
		scroll.AddChild(col);

		var title = new Label { Text = "SPIRE RECOLOR", HorizontalAlignment = HorizontalAlignment.Center, Modulate = new Color(1f, 0.85f, 0.4f) };
		title.AddThemeFontSizeOverride("font_size", 30);
		col.AddChild(title);

		col.AddChild(new Label { Text = "Who to recolor  (* = already recolored)" });
		_target = new OptionButton { FitToLongestItem = false };
		PopulateTargets();
		_target.ItemSelected += idx =>
		{
			var e = _entries.FirstOrDefault(x => x.ItemIndex == (int)idx && x.Create != null);
			if (e != null)
				SelectEntry(e);
		};
		col.AddChild(_target);

		col.AddChild(new Label { Text = "Part  (* = has its own colors)" });
		var partRow = new HBoxContainer();
		_part = new OptionButton { FitToLongestItem = false, SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, TooltipText = "Pick one piece of the model to give it its own colors." };
		_part.ItemSelected += idx =>
		{
			if (!_suppress)
				SelectPart(idx <= 0 ? null : _partNames[(int)idx - 1]);
		};
		partRow.AddChild(_part);
		var flash = new Button { Text = "Show me", TooltipText = "Flash the selected part yellow on the preview" };
		flash.Pressed += () => FlashPart(_currentPart);
		partRow.AddChild(flash);
		col.AddChild(partRow);

		var toggles = new HBoxContainer();
		_enabled = new CheckBox { Text = "Recolor on", TooltipText = "Turn this creature's recolor on/off without losing the settings." };
		_enabled.Toggled += on => Edit(t => t.Enabled = on);
		toggles.AddChild(_enabled);
		_showOriginal = new CheckBox { Text = "Show original (preview only)" };
		_showOriginal.Toggled += _ => ApplyPreviewBypass();
		toggles.AddChild(_showOriginal);
		col.AddChild(toggles);

		_settingsHeader = Header("Whole body");
		col.AddChild(_settingsHeader);
		_hue = SliderRow(col, "Hue shift", -180, 180, 1, v => Edit(t => t.Hue = (float)v), v => $"{v:0}°");
		_sat = SliderRow(col, "Saturation", 0, 3, 0.01, v => Edit(t => t.Saturation = (float)v), v => $"{v:0.00}x");
		_bright = SliderRow(col, "Brightness", 0, 2, 0.01, v => Edit(t => t.Brightness = (float)v), v => $"{v:0.00}x");
		_contrast = SliderRow(col, "Contrast", 0, 2, 0.01, v => Edit(t => t.Contrast = (float)v), v => $"{v:0.00}x");

		var tintRow = new HBoxContainer();
		tintRow.AddChild(new Label { Text = "Tint color", CustomMinimumSize = new Vector2(120, 0) });
		_tint = new ColorPickerButton { CustomMinimumSize = new Vector2(70, 32), EditAlpha = false, TooltipText = "Paint the whole creature this color (use Tint strength)." };
		_tint.ColorChanged += c => Edit(t => t.Tint = Recolorer.ToHex(c));
		tintRow.AddChild(_tint);
		var pickTint = new Button { Text = "Pick", TooltipText = "Click, then click a spot on the preview to use its color" };
		pickTint.Pressed += BeginPickTint;
		tintRow.AddChild(pickTint);
		col.AddChild(tintRow);
		_tintAmt = SliderRow(col, "Tint strength", 0, 1, 0.01, v => Edit(t => t.TintStrength = (float)v), v => $"{v * 100:0}%");

		// Picture texture: a picture laid over the colors (this part, or the whole body).
		col.AddChild(Header("Picture texture"));
		var picRow = new HBoxContainer();
		var choose = new Button { Text = "Choose picture…", TooltipText = "Pick a PNG/JPG/WEBP. It's copied into the mod's textures folder." };
		choose.Pressed += ChoosePicture;
		picRow.AddChild(choose);
		_picName = new Label { Text = "none", SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, ClipText = true };
		picRow.AddChild(_picName);
		var removePic = new Button { Text = "Remove", TooltipText = "Stop using a picture here." };
		removePic.Pressed += () => Edit(t => t.Picture = null);
		picRow.AddChild(removePic);
		col.AddChild(picRow);
		var modeRow = new HBoxContainer();
		modeRow.AddChild(new Label { Text = "Picture mode", CustomMinimumSize = new Vector2(120, 0) });
		_picMode = new OptionButton { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
		_picMode.AddItem("Picture colors (keeps the shading)");
		_picMode.AddItem("Texture only (light & dark detail)");
		_picMode.ItemSelected += i => Edit(t => t.PictureMode = i == 1 ? "texture" : "colors");
		modeRow.AddChild(_picMode);
		col.AddChild(modeRow);
		_picAmt = SliderRow(col, "Picture opacity", 0, 1, 0.01, v => Edit(t => t.PictureOpacity = (float)v), v => $"{v * 100:0}%");
		_picScale = SliderRow(col, "Picture size", 0.5, 32, 0.1, v => Edit(t => t.PictureScale = (float)v), v => $"{v:0.0}x repeat");

		col.AddChild(Header("Color swaps  (turn one color into another)"));
		col.AddChild(new Label
		{
			Text = "Add a swap, click the color you want to change on the preview, then choose what it becomes. Range widens or narrows how much of that color family gets caught.",
			AutowrapMode = TextServer.AutowrapMode.WordSmart,
			Modulate = new Color(0.8f, 0.8f, 0.85f)
		});
		_swapList = new VBoxContainer();
		col.AddChild(_swapList);
		var add = new Button { Text = "+ Add color swap" };
		add.Pressed += () =>
		{
			var t = CurrentTarget(true)!;
			if (t.Swaps.Count >= RecolorShader.MaxSwaps)
			{
				SetStatus($"Max {RecolorShader.MaxSwaps} swaps per creature.");
				return;
			}
			t.Swaps.Add(new ColorSwap());
			Changed();
			RebuildSwaps();
			BeginPick(t.Swaps.Count - 1);
		};
		col.AddChild(add);

		BuildModelSection(col);

		col.AddChild(Header("Share with a friend"));
		var shareRow = new HBoxContainer();
		var copy = new Button { Text = "Copy share code", SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
		copy.Pressed += () =>
		{
			FlushSave();
			DisplayServer.ClipboardSet(Palette.ExportShareCode());
			SetStatus("Share code copied. Send it to your friend; they press F8 → Paste share code.");
		};
		shareRow.AddChild(copy);
		var paste = new Button { Text = "Paste share code", SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
		paste.Pressed += () =>
		{
			try
			{
				int n = Palette.ImportShareCode(DisplayServer.ClipboardGet());
				LoadControls();
				RebuildSwaps();
				RefreshTargetLabels();
				SetStatus($"Imported {n} recolor(s) from the share code.");
			}
			catch (Exception ex)
			{
				SetStatus("Clipboard doesn't contain a valid share code. (" + ex.Message + ")");
			}
		};
		shareRow.AddChild(paste);
		col.AddChild(shareRow);
		col.AddChild(new Label
		{
			Text = "Share codes carry colors only. Repainted models travel in a share pack file:",
			AutowrapMode = TextServer.AutowrapMode.WordSmart,
			Modulate = new Color(0.8f, 0.8f, 0.85f)
		});
		var packRow = new HBoxContainer();
		var makePack = new Button { Text = "Make share pack", SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, TooltipText = "Creates one .zip with all your colors and repainted parts, and opens its folder." };
		makePack.Pressed += () =>
		{
			try
			{
				FlushSave();
				var (path, parts) = ModelSwap.MakeSharePack();
				OS.ShellOpen(ModEntry.ModDir);
				SetStatus($"Made {Path.GetFileName(path)} (colors + {parts} repainted part(s)). Send that file to your friend.");
			}
			catch (Exception ex) { SetStatus("Couldn't make the share pack: " + ex.Message); }
		};
		packRow.AddChild(makePack);
		var loadPack = new Button { Text = "Load share pack", SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, TooltipText = "Loads any pack .zip placed in the mod's 'incoming' folder." };
		loadPack.Pressed += () =>
		{
			try
			{
				string? result = ModelSwap.ImportIncoming();
				if (result == null)
				{
					OS.ShellOpen(ModelSwap.IncomingDir);
					SetStatus("No pack found. Put your friend's .zip into the 'incoming' folder (just opened), then press Load share pack again.");
					return;
				}
				LoadControls();
				RebuildSwaps();
				RefreshTargetLabels();
				RefreshModelSection();
				SetStatus(result);
			}
			catch (Exception ex) { SetStatus("Couldn't load the share pack: " + ex.Message); }
		};
		packRow.AddChild(loadPack);
		col.AddChild(packRow);

		var bottom = new HBoxContainer();
		var reset = new Button { Text = "Reset this one", SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, TooltipText = "Resets the selected part, or the whole creature when 'Whole body' is selected." };
		reset.Pressed += () =>
		{
			if (_current == null)
				return;
			if (_currentPart != null)
			{
				var top = Palette.Get(_current.Key);
				if (top?.Parts != null)
				{
					top.Parts.Remove(_currentPart);
					if (top.Parts.Count == 0)
						top.Parts = null;
				}
				Changed();
				SetStatus($"{_currentPart} now follows the whole-body colors again.");
			}
			else
			{
				Palette.Remove(_current.Key);
				_saveAt = Now + 0.1;
				RefreshTargetLabels();
				SetStatus($"{_current.Label} is back to its original colors.");
			}
			LoadControls();
			RebuildSwaps();
			RefreshPartLabels();
		};
		bottom.AddChild(reset);
		var close = new Button { Text = "Close (F8)", SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
		close.Pressed += Close;
		bottom.AddChild(close);
		col.AddChild(bottom);

		_status = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart, Modulate = new Color(0.6f, 1f, 0.7f) };
		col.AddChild(_status);
		col.AddChild(new Label
		{
			Text = "Cosmetic only — safe in multiplayer. Saved automatically to palette.json in the mod folder.",
			AutowrapMode = TextServer.AutowrapMode.WordSmart,
			Modulate = new Color(0.6f, 0.6f, 0.7f)
		});
	}

	private static void BuildEntries()
	{
		_entries.Clear();
		try
		{
			foreach (var c in ModelDb.AllCharacters)
			{
				_entries.Add(new Entry { Key = c.Id.Entry.ToLowerInvariant(), Label = SafeTitle(() => c.Title.GetFormattedText(), c.Id.Entry), Group = "Characters", Create = c.CreateVisuals });
				// Osty, the Necrobinder's pet, right after her (Joseph, 2026-09-27: "osty is the only pet").
				if (c.Id.Entry.Equals("NECROBINDER", StringComparison.OrdinalIgnoreCase)
				    && ModelDb.All.OfType<MonsterModel>().FirstOrDefault(m => m.Id.Entry.Equals("OSTY", StringComparison.OrdinalIgnoreCase)) is { } osty)
					_entries.Add(new Entry { Key = osty.Id.Entry.ToLowerInvariant(), Label = SafeTitle(() => osty.Title.GetFormattedText(), "Osty") + "  (Necrobinder's pet)", Group = "Characters", Create = osty.CreateVisuals, Monster = osty });
			}
		}
		catch (Exception ex) { ModEntry.Log($"Character list failed: {ex.Message}"); }


		// Ancients (Joseph, 2026-09-27: "make the ancients recolorable"): each one is drawn inside its event's
		// background scene, so the preview shows that scene and the recolor touches only its Spine art.
		try
		{
			foreach (var an in ModelDb.AllAncients.GroupBy(x => x.Id.Entry).Select(g => g.First())
				         .OrderBy(x => SafeTitle(() => x.Title.GetFormattedText(), x.Id.Entry)))
			{
				string key = an.Id.Entry.ToLowerInvariant();
				_entries.Add(new Entry
				{
					Key = key, Label = SafeTitle(() => an.Title.GetFormattedText(), an.Id.Entry), Group = "Ancients",
					Create = () =>
					{
						var scene = an.CreateBackgroundScene().Instantiate<Control>(PackedScene.GenEditState.Disabled);
						scene.SetMeta(Recolorer.KeyMeta, key);
						scene.Size = new Vector2(1920, 1080);
						return scene;
					},
				});
			}
		}
		catch (Exception ex) { ModEntry.Log($"Ancient list failed: {ex.Message}"); }

		var bossKeys = new HashSet<string>();
		try
		{
			var bosses = ModelDb.AllEncounters.Where(e => e.RoomType == RoomType.Boss)
				.SelectMany(e => e.AllPossibleMonsters).Distinct().ToList();
			foreach (var m in bosses.OrderBy(m => SafeTitle(() => m.Title.GetFormattedText(), m.Id.Entry)))
			{
				string key = m.Id.Entry.ToLowerInvariant();
				if (!bossKeys.Add(key))
					continue;
				_entries.Add(new Entry { Key = key, Label = SafeTitle(() => m.Title.GetFormattedText(), m.Id.Entry), Group = "Act Bosses", Create = m.CreateVisuals, Monster = m });
			}
		}
		catch (Exception ex) { ModEntry.Log($"Boss list failed: {ex.Message}"); }

		try
		{
			foreach (var m in ModelDb.Monsters.Where(m => !bossKeys.Contains(m.Id.Entry.ToLowerInvariant()))
				         .OrderBy(m => SafeTitle(() => m.Title.GetFormattedText(), m.Id.Entry)))
			{
				_entries.Add(new Entry { Key = m.Id.Entry.ToLowerInvariant(), Label = SafeTitle(() => m.Title.GetFormattedText(), m.Id.Entry), Group = "Other Monsters", Create = m.CreateVisuals, Monster = m });
			}
		}
		catch (Exception ex) { ModEntry.Log($"Monster list failed: {ex.Message}"); }
	}

	private static string SafeTitle(Func<string> f, string fallback)
	{
		try
		{
			string s = f();
			return string.IsNullOrWhiteSpace(s) ? fallback : s;
		}
		catch
		{
			return fallback;
		}
	}

	private static void PopulateTargets()
	{
		_target.Clear();
		string group = "";
		foreach (var e in _entries)
		{
			if (e.Group != group)
			{
				group = e.Group;
				_target.AddSeparator("— " + group + " —");
			}
			e.ItemIndex = _target.ItemCount;
			_target.AddItem(e.Label);
		}
		RefreshTargetLabels();
	}

	private static void RefreshTargetLabels()
	{
		foreach (var e in _entries)
		{
			var t = Palette.Get(e.Key);
			bool on = t != null && !t.IsIdentity;
			_target.SetItemText(e.ItemIndex, (on ? "* " : "   ") + e.Label);
		}
	}

	// ---------------------------------------------------------------- selection + preview

	// ---------------------------------------------------------------- custom model (characters)

	private static VBoxContainer _modelSection = null!;
	private static CheckBox _useModel = null!;
	private static Label _modelInfo = null!;
	private static HashSet<string>? _characterKeys;

	public static bool IsCharacterKey(string key)
	{
		if (_characterKeys == null)
		{
			try { _characterKeys = ModelDb.AllCharacters.Select(c => c.Id.Entry.ToLowerInvariant()).ToHashSet(); }
			catch { return false; }
		}
		return _characterKeys.Contains(key);
	}

	private static void BuildModelSection(VBoxContainer col)
	{
		_modelSection = new VBoxContainer();
		col.AddChild(_modelSection);
		_modelSection.AddChild(Header("Custom model  (repaint parts)"));
		_modelSection.AddChild(new Label
		{
			Text = "1) Export parts  2) edit/replace any PNG in the folder that opens (bigger is fine)  3) Reload my edits. All the original animations keep working.",
			AutowrapMode = TextServer.AutowrapMode.WordSmart,
			Modulate = new Color(0.8f, 0.8f, 0.85f)
		});
		_useModel = new CheckBox { Text = "Use my repainted parts" };
		_useModel.Toggled += on =>
		{
			if (_suppress || _current == null)
				return;
			Palette.GetOrCreate(_current.Key).CustomModel = on;
			Changed();
			RefreshModelSection();
		};
		_modelSection.AddChild(_useModel);

		var row = new HBoxContainer();
		var export = new Button { Text = "Export parts to edit", SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
		export.Pressed += () =>
		{
			if (_current == null || PreviewBody is not Node body || body.GetClass() != "SpineSprite")
			{
				SetStatus("Wait for the preview to appear, then try again.");
				return;
			}
			try
			{
				int n = ModelSwap.Export(_current.Key, body);
				OS.ShellOpen(ModelSwap.CharacterDir(_current.Key));
				SetStatus($"Exported {n} parts to the folder that just opened. Edit any of them, then press Reload my edits.");
				RefreshModelSection();
			}
			catch (Exception ex) { SetStatus("Export failed: " + ex.Message); }
		};
		row.AddChild(export);
		var open = new Button { Text = "Open parts folder", SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
		open.Pressed += () =>
		{
			if (_current == null)
				return;
			string dir = ModelSwap.CharacterDir(_current.Key);
			if (!Directory.Exists(dir))
			{
				SetStatus("Nothing exported yet — press Export parts to edit first.");
				return;
			}
			OS.ShellOpen(dir);
		};
		row.AddChild(open);
		_modelSection.AddChild(row);

		var reload = new Button { Text = "Reload my edits" };
		reload.Pressed += () =>
		{
			Palette.Touch();
			RefreshModelSection();
			SetStatus(_current == null ? "" : $"Reloaded. {ModelSwap.EditedFiles(_current.Key).Count} repainted part(s) in use for {_current.Label}.");
		};
		_modelSection.AddChild(reload);
		_modelInfo = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart, Modulate = new Color(0.6f, 1f, 0.7f) };
		_modelSection.AddChild(_modelInfo);
	}

	private static void RefreshModelSection()
	{
		if (_modelSection == null || !GodotObject.IsInstanceValid(_modelSection))
			return;
		bool isChar = _current != null && IsCharacterKey(_current.Key);
		_modelSection.Visible = isChar;
		if (!isChar)
			return;
		_suppress = true;
		_useModel.ButtonPressed = Palette.Get(_current!.Key)?.CustomModel ?? true;
		_suppress = false;
		int edited = ModelSwap.EditedFiles(_current.Key).Count;
		_modelInfo.Text = !Directory.Exists(ModelSwap.CharacterDir(_current.Key))
			? "No parts exported yet."
			: edited == 0 ? "Parts exported — none edited yet." : $"{edited} repainted part(s) found.";
	}

	private static void SelectEntry(Entry? e)
	{
		if (e == null)
			return;
		_current = e;
		_currentPart = null;
		_settingsHeader.Text = "Whole body";
		_partNames.Clear();
		_part.Clear();
		_part.AddItem("Whole body");
		_pickSwap = -1;
		_pickArmed = false;
		_suppress = true;
		_target.Select(e.ItemIndex);
		_suppress = false;
		LoadControls();
		RebuildSwaps();
		RefreshModelSection();
		ShowPreview(e);
		SetStatus("");
	}

	private static void ShowPreview(Entry e)
	{
		ClearPreview();
		try
		{
			// Tagged by the same CreateVisuals hook combat uses, so the preview proves the in-game path.
			_preview = e.Create!();
			_holder.AddChild(_preview);
			_previewAge = 0;
			ApplyPreviewBypass();
		}
		catch (Exception ex)
		{
			_preview = null;
			SetStatus($"Couldn't build a preview for {e.Label} ({ex.Message}). The recolor still applies in game.");
		}
	}

	private static void ClearPreview()
	{
		if (_preview != null && GodotObject.IsInstanceValid(_preview))
			_preview.QueueFree();
		_preview = null;
	}

	private static void StartPreviewAnimation()
	{
		if (_preview == null)
			return;
		try
		{
			if (_current?.Monster != null && _preview is NCreatureVisuals cv)
				cv.SetUpSkin(_current.Monster);
		}
		catch (Exception ex) { ModEntry.Log($"Preview skin setup skipped: {ex.Message}"); }
		try
		{
			var body = (_preview as NCreatureVisuals)?.SpineBody;
			if (body == null)
				return; // Ancient scenes animate themselves
			foreach (string anim in new[] { "idle_loop", "idle", "Idle", "idle_1" })
			{
				if (body.HasAnimation(anim))
				{
					body.GetAnimationState().SetAnimation(anim);
					break;
				}
			}
		}
		catch (Exception ex) { ModEntry.Log($"Preview animation skipped: {ex.Message}"); }
		Recolorer.Apply(_preview);
	}

	private static void FitPreview()
	{
		if (_preview == null)
			return;
		Vector2 area = _vp.Size;
		if (area.X < 10 || area.Y < 10)
			return;
		Rect2 b = new Rect2(-150, -350, 300, 350);
		try
		{
			var bounds = (_preview as NCreatureVisuals)?.Bounds;
			if (bounds != null && bounds.Size.X > 1 && bounds.Size.Y > 1)
				b = new Rect2(bounds.Position, bounds.Size);
		}
		catch { }
		// The game's Bounds box is a hitbox and leaves out long pieces like the Necrobinder's scythe (Joseph,
		// 2026-09-27: "you cant preview the end of the necrobinders scythe"). Also frame the whole drawn skeleton,
		// grown over the animation so the view settles instead of wobbling.
		if (_fitFor != _preview.GetInstanceId()) { _fitFor = _preview.GetInstanceId(); _fitRect = null; }
		try
		{
			if (_preview is NCreatureVisuals && PreviewBody is Node2D body && body.GetClass() == "SpineSprite")
			{
				var skel = body.Call("get_skeleton").AsGodotObject();
				if (skel != null)
				{
					Rect2 sb = skel.Call("get_bounds").AsRect2();
					if (sb.Size.X > 1 && sb.Size.Y > 1)
					{
						Transform2D x = ((CanvasItem)_preview).GetGlobalTransform().AffineInverse() * body.GetGlobalTransform();
						Rect2 local = new Rect2(x * sb.Position, Vector2.Zero)
							.Expand(x * new Vector2(sb.End.X, sb.Position.Y))
							.Expand(x * new Vector2(sb.Position.X, sb.End.Y))
							.Expand(x * sb.End);
						// creatures: never smaller than their hitbox; Ancient scenes: just the Ancient's skeleton
						_fitRect = _fitRect is { } r ? r.Merge(local) : (_preview is NCreatureVisuals ? local.Merge(b) : local);
					}
				}
			}
		}
		catch { }
		if (_fitRect is { } fit) b = fit;
		else if (_preview is Control && _preview is not NCreatureVisuals)
			b = new Rect2(0, 0, 1920, 1080); // an Ancient's picture fills its whole scene
		float scale = Mathf.Clamp(Mathf.Min(area.X * 0.85f / b.Size.X, area.Y * 0.85f / b.Size.Y), 0.15f, 4f);
		_holder.Scale = Vector2.One * scale;
		_holder.Position = area / 2f - (b.Position + b.Size / 2f) * scale;
	}

	private static void ApplyPreviewBypass()
	{
		if (_preview == null || !GodotObject.IsInstanceValid(_preview))
			return;
		if (_showOriginal.ButtonPressed || (_pickFrames > 0 && _pickWhat == PickWhat.SwapFrom))
			_preview.SetMeta("sts2rc_bypass", true);
		else if (_preview.HasMeta("sts2rc_bypass"))
			_preview.RemoveMeta("sts2rc_bypass");
		Recolorer.Apply(_preview);
	}

	// ---------------------------------------------------------------- eyedropper

	private static void BeginPick(int swapIndex)
	{
		_pickSwap = swapIndex;
		_pickWhat = PickWhat.SwapFrom;
		_pickArmed = true;
		SetStatus($"Swap #{swapIndex + 1}: click the color you want to change on the preview.");
	}

	private static void BeginPickTo(int swapIndex)
	{
		_pickSwap = swapIndex;
		_pickWhat = PickWhat.SwapTo;
		_pickArmed = true;
		SetStatus($"Swap #{swapIndex + 1}: click the color on the preview it should turn into.");
	}

	private static void BeginPickTint()
	{
		_pickSwap = -1;
		_pickWhat = PickWhat.Tint;
		_pickArmed = true;
		SetStatus("Click a spot on the preview to use its color as the tint color.");
	}

	// Click-to-select: draw every part as an ID color for a couple of frames, read the pixel, select that part.
	private static void BeginSelect(Vector2 pos)
	{
		if (_current == null || _preview == null || !GodotObject.IsInstanceValid(_preview)) return;
		_selectPos = pos;
		Recolorer.IdPickKey = _current.Key;
		Recolorer.Apply(_preview);
		_selectFrames = 3;
	}

	private static void FinishSelect()
	{
		string? slot = null;
		try
		{
			Image img = _vp.GetTexture().GetImage();
			Vector2 ratio = new Vector2(img.GetWidth() / Mathf.Max(_vpContainer.Size.X, 1), img.GetHeight() / Mathf.Max(_vpContainer.Size.Y, 1));
			int x = Mathf.Clamp((int)(_selectPos.X * ratio.X), 0, img.GetWidth() - 1);
			int y = Mathf.Clamp((int)(_selectPos.Y * ratio.Y), 0, img.GetHeight() - 1);
			Color px = img.GetPixel(x, y);
			slot = Recolorer.SlotFromIdPixel(px);
			if (SelectDebug)
			{
				ModEntry.Log($"select: click ({_selectPos.X:0},{_selectPos.Y:0}) -> image ({x},{y}) of {img.GetWidth()}x{img.GetHeight()}, container {_vpContainer.Size}, pixel {px} -> {slot ?? "none"} ({Recolorer.IdSlots.Count} slots)");
				img.SavePng(System.IO.Path.Combine(ModEntry.ModDir, "_select_debug.png"));
			}
		}
		catch (Exception ex) { SetStatus("Couldn't read the preview: " + ex.Message); }
		finally
		{
			Recolorer.IdPickKey = null;
			if (_preview != null && GodotObject.IsInstanceValid(_preview)) Recolorer.Apply(_preview);
		}
		if (slot == null)
		{
			SetStatus("No part there (background or an effect). Click directly on the character.");
			return;
		}
		if (!_partNames.Contains(slot)) PopulateParts();
		SelectPart(slot);
		SetStatus($"Selected part: {slot}");
	}

	/// <summary>Test hook: the tint "Pick" button, then a click on the preview at (x, y).</summary>
	public static void DevPickTint(float x, float y)
	{
		BeginPickTint();
		_pickArmed = false;
		_pickPos = new Vector2(x, y);
		_pickFrames = 3;
		ApplyPreviewBypass();
	}

	/// <summary>Test hook: same as clicking the preview at (x, y) to select the part there.</summary>
	public static void DevSelectAt(float x, float y) => BeginSelect(new Vector2(x, y));

	public static string? CurrentPart => _currentPart;
	public static bool SelectDebug;   // test hook: log the ID-pass pixel and save the ID frame

	private static void OnPreviewInput(InputEvent ev)
	{
		if (ev is not InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left } mb)
			return;
		if (!_pickArmed)
		{
			// Not picking a color: a click selects the part under the cursor.
			if (_selectFrames == 0 && _pickFrames == 0) BeginSelect(mb.Position);
			return;
		}
		_pickArmed = false;
		_pickPos = mb.Position;
		_pickFrames = 3; // show the original colors for a couple of frames, then read the pixel
		ApplyPreviewBypass();
	}

	/// <summary>Test hook: same as clicking the preview at (x, y) after pressing Pick on a swap.</summary>
	public static void DevPick(int swapIndex, float x, float y)
	{
		BeginPick(swapIndex);
		_pickArmed = false;
		_pickPos = new Vector2(x, y);
		_pickFrames = 3;
		ApplyPreviewBypass();
	}

	public static IReadOnlyList<string> PartNames => _partNames;

	/// <summary>Test hook: export the current character's parts (same as the button, minus opening Explorer).</summary>
	public static int DevExport()
	{
		if (_current == null || PreviewBody is not Node body)
			throw new InvalidOperationException("no preview");
		return ModelSwap.Export(_current.Key, body);
	}

	public static void DevInspect()
	{
		if (PreviewBody is not Node body)
		{
			ModEntry.Log("inspect: no preview body");
			if (_preview != null && GodotObject.IsInstanceValid(_preview)) DumpTree(_preview, 0);
			return;
		}
		ModEntry.Log($"inspect: body class={body.GetClass()} normal_material={body.Call("get_normal_material")}");
		foreach (Node c in body.GetChildren())
		{
			string extra = c.GetClass() == "SpineSlotNode" ? $" slot={c.Get("slot_name")} mat={c.Get("normal_material")} props=" + string.Join(",", c.GetPropertyList().Select(p => p["name"].AsString()).Where(n => n.Contains("material") || n.Contains("slot"))) : "";
			ModEntry.Log($"inspect:   child {c.Name} class={c.GetClass()}{extra}");
		}
		// The whole creature, not just the Spine body: effects like the Necrobinder's head flames can be
		// separate nodes (particles / sprites) or slots with their own material (2026-09-27).
		if (_preview != null && GodotObject.IsInstanceValid(_preview)) DumpTree(_preview, 0);
	}

	private static void DumpTree(Node n, int depth)
	{
		if (depth > 12) return;
		string info = $"{new string(' ', depth * 2)}{n.Name} [{n.GetClass()}]";
		try
		{
			if (n is CanvasItem ci)
			{
				info += ci.Visible ? "" : " hidden";
				if (ci.Material is { } m) info += $" material={m.GetClass()}:{m.ResourcePath}" + (m is ShaderMaterial sm && sm.Shader != null ? $" shader={sm.Shader.ResourcePath}" : "") + (m is CanvasItemMaterial cim ? $" blend={cim.BlendMode}" : "");
				if (ci.Modulate != Colors.White) info += $" modulate={ci.Modulate}";
				if (ci.SelfModulate != Colors.White) info += $" self_modulate={ci.SelfModulate}";
			}
			foreach (var prop in new[] { "texture", "slot_name", "normal_material", "additive_material", "process_material", "sprite_frames", "skeleton_data_res" })
			{
				try { var v = n.Get(prop); if (v.VariantType != Variant.Type.Nil) info += $" {prop}={(v.Obj is Resource r ? r.GetClass() + ":" + r.ResourcePath : v.ToString())}"; } catch { }
			}
		}
		catch { }
		ModEntry.Log("tree: " + info);
		try
		{
			// Where an effect's color comes from: shader parameters, and particle color/gradients.
			if (n is CanvasItem ci2 && ci2.Material is ShaderMaterial sm2 && sm2.Shader != null)
				foreach (var u in sm2.Shader.GetShaderUniformList())
				{
					string name = u.AsGodotDictionary()["name"].AsString();
					var v = sm2.GetShaderParameter(name);
					string desc = v.Obj is GradientTexture1D gt && gt.Gradient != null ? $"Gradient[{string.Join(" ", gt.Gradient.Colors)}]"
						: v.Obj is Resource r ? r.GetClass() + ":" + r.ResourcePath : v.ToString();
					ModEntry.Log($"tree: {new string(' ', depth * 2)}  uniform {name} = {desc}");
				}
			if (n.Get("process_material").Obj is ParticleProcessMaterial pm)
			{
				string ramp(Texture2D? t) => t is GradientTexture1D g && g.Gradient != null ? string.Join(" ", g.Gradient.Colors) : t?.GetClass() ?? "none";
				ModEntry.Log($"tree: {new string(' ', depth * 2)}  particles color={pm.Color} ramp={ramp(pm.ColorRamp)} initRamp={ramp(pm.ColorInitialRamp)}");
			}
		}
		catch (Exception ex) { ModEntry.Log("tree: uniform read failed " + ex.Message); }
		foreach (Node c in n.GetChildren()) DumpTree(c, depth + 1);
	}

	/// <summary>Test hook: move a slider exactly as a user would (goes through the normal edit path).</summary>
	public static void DevSlider(string name, double value)
	{
		HSlider s = name switch
		{
			"hue" => _hue, "saturation" => _sat, "brightness" => _bright, "contrast" => _contrast, "tint" => _tintAmt,
			"picopacity" => _picAmt, "picsize" => _picScale,
			_ => throw new ArgumentException("unknown slider " + name)
		};
		s.Value = value;
	}

	public static string Status => _status != null && GodotObject.IsInstanceValid(_status) ? _status.Text : "";

	private static void FinishPick()
	{
		try
		{
			Image img = _vp.GetTexture().GetImage();
			Vector2 ratio = new Vector2(img.GetWidth() / Mathf.Max(_vpContainer.Size.X, 1), img.GetHeight() / Mathf.Max(_vpContainer.Size.Y, 1));
			int x = Mathf.Clamp((int)(_pickPos.X * ratio.X), 0, img.GetWidth() - 1);
			int y = Mathf.Clamp((int)(_pickPos.Y * ratio.Y), 0, img.GetHeight() - 1);
			Color c = img.GetPixel(x, y);
			var t = CurrentTarget(false);
			if (c.A < 0.25f)
			{
				SetStatus("That spot is empty background — click directly on the creature.");
				_pickArmed = true;
			}
			else if (_pickWhat == PickWhat.Tint)
			{
				c.A = 1f;
				Edit(tt => { tt.Tint = Recolorer.ToHex(c); if (tt.TintStrength < 0.001f) tt.TintStrength = 0.6f; });
				LoadControls();
				SetStatus($"Tint color set to {Recolorer.ToHex(c)}.");
			}
			else if (_pickWhat == PickWhat.SwapTo && t != null && _pickSwap >= 0 && _pickSwap < t.Swaps.Count)
			{
				c.A = 1f;
				t.Swaps[_pickSwap].To = Recolorer.ToHex(c);
				Changed();
				RebuildSwaps();
				SetStatus($"Swap #{_pickSwap + 1} now turns into {Recolorer.ToHex(c)}.");
				_pickSwap = -1;
			}
			else if (t != null && _pickSwap >= 0 && _pickSwap < t.Swaps.Count)
			{
				c.A = 1f;
				var swap = t.Swaps[_pickSwap];
				swap.From = Recolorer.ToHex(c);
				if (swap.To == new ColorSwap().To)
					swap.To = Recolorer.ToHex(Color.FromHsv((c.H + 0.5f) % 1f, Mathf.Max(c.S, 0.5f), Mathf.Max(c.V, 0.4f)));
				Changed();
				RebuildSwaps();
				SetStatus($"Picked {swap.From}. Now choose what it turns into (the right-hand swatch).");
				_pickSwap = -1;
			}
		}
		catch (Exception ex)
		{
			SetStatus("Color pick failed: " + ex.Message);
		}
		ApplyPreviewBypass();
	}

	// ---------------------------------------------------------------- editing

	/// <summary>The settings being edited: the whole body, or the selected part's own settings.</summary>
	private static TargetRecolor? CurrentTarget(bool create)
	{
		if (_current == null)
			return null;
		var top = create ? Palette.GetOrCreate(_current.Key) : Palette.Get(_current.Key);
		if (_currentPart == null || top == null)
			return top;
		if (top.Parts != null && top.Parts.TryGetValue(_currentPart, out var part))
			return part;
		if (!create)
			return null;
		// A part starts out matching the whole body, so splitting it off changes nothing until you edit it.
		top.Parts ??= new Dictionary<string, TargetRecolor>();
		part = top.CloneLook();
		part.Enabled = true;
		top.Parts[_currentPart] = part;
		return part;
	}

	/// <summary>What the controls should display: the edited settings, or what a not-yet-split part inherits.</summary>
	private static TargetRecolor ViewTarget()
	{
		var t = CurrentTarget(false);
		if (t != null)
			return t;
		if (_currentPart != null && _current != null && Palette.Get(_current.Key) is { } top)
		{
			var look = top.CloneLook();
			look.Enabled = true;
			return look;
		}
		return new TargetRecolor();
	}

	// ---------------------------------------------------------------- parts

	private static void PopulateParts()
	{
		_partNames.Clear();
		_groupSizes.Clear();
		var slots = PreviewBody is Node body && body.GetClass() == "SpineSprite" ? Recolorer.GetSlotNames(body) : new List<string>();
		var effects = _preview != null && GodotObject.IsInstanceValid(_preview) ? EffectRecolor.PartNames(_preview) : new List<string>();
		// 1) groups, biggest first: "Clothes (12 parts)", "Left arm (9 parts)", ..., "All flames"
		var groups = PartGroups.For(slots);
		if (effects.Contains(EffectRecolor.AllFlames))
			groups.Add((EffectRecolor.AllFlames, PartGroups.MembersOf(EffectRecolor.AllFlames, slots)));
		foreach (var (key, members) in groups.OrderByDescending(g => g.Members.Count))
		{
			_partNames.Add(key);
			_groupSizes[key] = members.Count;
		}
		// 2) then every individual piece, and the individual effects ("Effect: Head flames")
		_partNames.AddRange(slots.OrderBy(n => n, StringComparer.OrdinalIgnoreCase));
		_partNames.AddRange(effects.Where(e => e != EffectRecolor.AllFlames));
		_suppress = true;
		_part.Clear();
		_part.AddItem("Whole body");
		foreach (string n in _partNames)
			_part.AddItem(PartLabel(n));
		int sel = _currentPart == null ? 0 : _partNames.IndexOf(_currentPart) + 1;
		_part.Select(Math.Max(sel, 0));
		_suppress = false;
		RefreshPartLabels();
	}

	private static void RefreshPartLabels()
	{
		if (_current == null || _part.ItemCount != _partNames.Count + 1)
			return;
		var parts = Palette.Get(_current.Key)?.Parts;
		_part.SetItemText(0, parts is { Count: > 0 } ? $"Whole body  ({parts.Count} part(s) customised)" : "Whole body");
		for (int i = 0; i < _partNames.Count; i++)
			_part.SetItemText(i + 1, (parts != null && parts.ContainsKey(_partNames[i]) ? "* " : "   ") + PartLabel(_partNames[i]));
	}

	private static readonly Dictionary<string, int> _groupSizes = new();

	// "grp:Left arm" → "Left arm  (9 parts)"; "fx:Head flames" → "Effect: Head flames"; slots unchanged.
	private static string PartLabel(string key)
	{
		if (key.StartsWith(PartGroups.Prefix))
			return $"{key[PartGroups.Prefix.Length..]}  ({(_groupSizes.TryGetValue(key, out var n) ? n : 0)} parts)";
		if (key == EffectRecolor.AllFlames)
			return EffectRecolor.Display(key);
		return EffectRecolor.Display(key);
	}

	public static void SelectPart(string? part)
	{
		if (part != null && !_partNames.Contains(part))
			throw new ArgumentException("unknown part " + part);
		_currentPart = part;
		_settingsHeader.Text = part == null ? "Whole body" : (part.StartsWith(PartGroups.Prefix) || part == EffectRecolor.AllFlames ? "Group: " : "Part: ") + PartLabel(part);
		_pickSwap = -1;
		_pickArmed = false;
		_suppress = true;
		_part.Select(part == null ? 0 : _partNames.IndexOf(part) + 1);
		_suppress = false;
		LoadControls();
		RebuildSwaps();
		if (part != null)
		{
			FlashPart(part);
			SetStatus($"Editing part \"{part}\". Changes here only affect this piece.");
		}
		else
		{
			SetStatus("Editing the whole body.");
		}
	}

	private static void FlashPart(string? part)
	{
		if (_current == null || part == null)
			return;
		Recolorer.Highlight = (_current.Key, part);
		_highlightFrames = 45;
		Palette.Touch();
	}

	private static void Edit(Action<TargetRecolor> change)
	{
		if (_suppress || _current == null)
			return;
		var t = CurrentTarget(true)!;
		change(t);
		Changed();
	}

	// Picture texture: the OS file picker, then copy the picture into textures/ and use it here.
	private static void ChoosePicture()
	{
		if (_current == null) return;
		var dlg = new FileDialog
		{
			FileMode = FileDialog.FileModeEnum.OpenFile, Access = FileDialog.AccessEnum.Filesystem,
			UseNativeDialog = true, Title = "Choose a picture to use as a texture",
			Filters = new[] { "*.png, *.jpg, *.jpeg, *.webp ; Pictures" },
		};
		dlg.FileSelected += path =>
		{
			try { SetPicture(path); }
			catch (Exception ex) { SetStatus("Couldn't use that picture: " + ex.Message); }
			dlg.QueueFree();
		};
		dlg.Canceled += () => dlg.QueueFree();
		_layer!.AddChild(dlg);
		dlg.PopupCentered(new Vector2I(900, 600));
	}

	/// <summary>Use a picture file on the current part/body (also the test hook "picture &lt;path&gt;").</summary>
	public static void SetPicture(string path)
	{
		string name = PictureStore.Import(path);
		bool wasSuppressed = _suppress;
		Edit(t => { t.Picture = name; if (t.PictureOpacity <= 0.001f) t.PictureOpacity = 0.6f; });
		LoadControls();
		SetStatus($"Using picture {name}. Adjust Picture opacity, size and mode.");
	}

	public static void DevPictureMode(string mode) => Edit(t => t.PictureMode = mode == "texture" ? "texture" : "colors");

	private static void LoadControls()
	{
		var t = ViewTarget();
		_suppress = true;
		_enabled.ButtonPressed = t.Enabled;
		_hue.Value = t.Hue;
		_sat.Value = t.Saturation;
		_bright.Value = t.Brightness;
		_contrast.Value = t.Contrast;
		_tint.Color = Recolorer.ParseColor(t.Tint, Colors.White);
		_tintAmt.Value = t.TintStrength;
		_picName.Text = string.IsNullOrEmpty(t.Picture) ? "none" : t.Picture + (PictureStore.Get(t.Picture) == null ? "  (missing file)" : "");
		_picMode.Select(t.PictureMode == "texture" ? 1 : 0);
		_picAmt.Value = t.PictureOpacity;
		_picScale.Value = t.PictureScale;
		_suppress = false;
	}

	private static void RebuildSwaps()
	{
		foreach (Node c in _swapList.GetChildren())
			c.QueueFree();
		var t = ViewTarget();
		for (int i = 0; i < t.Swaps.Count; i++)
		{
			int idx = i;
			var swap = t.Swaps[i];
			var row = new HBoxContainer();
			row.AddChild(new Label { Text = $"#{i + 1}", CustomMinimumSize = new Vector2(30, 0) });

			var from = new ColorPickerButton { Color = Recolorer.ParseColor(swap.From, Colors.Red), CustomMinimumSize = new Vector2(56, 32), EditAlpha = false, TooltipText = "Color to replace" };
			from.ColorChanged += c => Edit(tt => tt.Swaps[idx].From = Recolorer.ToHex(c));
			row.AddChild(from);

			var pick = new Button { Text = "Pick", TooltipText = "Click, then click a spot on the preview to grab its color" };
			pick.Pressed += () => BeginPick(idx);
			row.AddChild(pick);

			row.AddChild(new Label { Text = " → " });

			var to = new ColorPickerButton { Color = Recolorer.ParseColor(swap.To, Colors.Blue), CustomMinimumSize = new Vector2(56, 32), EditAlpha = false, TooltipText = "New color" };
			to.ColorChanged += c => Edit(tt => tt.Swaps[idx].To = Recolorer.ToHex(c));
			row.AddChild(to);
			var pickTo = new Button { Text = "Pick", TooltipText = "Click, then click a spot on the preview to use its color as the new color" };
			pickTo.Pressed += () => BeginPickTo(idx);
			row.AddChild(pickTo);

			row.AddChild(new Label { Text = "  Range" });
			var range = new HSlider { MinValue = 0.02, MaxValue = 1, Step = 0.01, Value = swap.Range, CustomMinimumSize = new Vector2(110, 0), SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, SizeFlagsVertical = Control.SizeFlags.ShrinkCenter };
			range.ValueChanged += v => Edit(tt => tt.Swaps[idx].Range = (float)v);
			row.AddChild(range);

			var del = new Button { Text = "X", TooltipText = "Remove this swap" };
			del.Pressed += () =>
			{
				var tt = CurrentTarget(false);
				if (tt == null || idx >= tt.Swaps.Count)
					return;
				tt.Swaps.RemoveAt(idx);
				Changed();
				RebuildSwaps();
			};
			row.AddChild(del);
			_swapList.AddChild(row);
		}
	}

	// ---------------------------------------------------------------- widgets

	private static HSlider SliderRow(VBoxContainer parent, string name, double min, double max, double step, Action<double> onChange, Func<double, string> fmt)
	{
		var row = new HBoxContainer();
		row.AddChild(new Label { Text = name, CustomMinimumSize = new Vector2(120, 0) });
		var slider = new HSlider { MinValue = min, MaxValue = max, Step = step, SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, SizeFlagsVertical = Control.SizeFlags.ShrinkCenter };
		var value = new Label { CustomMinimumSize = new Vector2(64, 0), HorizontalAlignment = HorizontalAlignment.Right };
		slider.ValueChanged += v =>
		{
			value.Text = fmt(v);
			onChange(v);
		};
		row.AddChild(slider);
		row.AddChild(value);
		var reset = new Button { Text = "↺", TooltipText = "Reset" };
		double def = name switch { "Hue shift" => 0, "Tint strength" => 0, "Picture opacity" => 0.6, "Picture size" => 4, _ => 1 };
		reset.Pressed += () => slider.Value = def;
		row.AddChild(reset);
		parent.AddChild(row);
		value.Text = fmt(slider.Value);
		return slider;
	}

	private static Label Header(string text)
	{
		var l = new Label { Text = text, Modulate = new Color(1f, 0.85f, 0.4f) };
		l.AddThemeFontSizeOverride("font_size", 20);
		return l;
	}

	private static StyleBoxFlat Box(Color bg, Color border)
	{
		var sb = new StyleBoxFlat { BgColor = bg, BorderColor = border };
		sb.SetBorderWidthAll(2);
		sb.SetCornerRadiusAll(8);
		sb.SetContentMarginAll(14);
		return sb;
	}

	private static void SetStatus(string s)
	{
		if (_status != null && GodotObject.IsInstanceValid(_status))
			_status.Text = s;
	}
}
