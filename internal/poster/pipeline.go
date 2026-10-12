package poster

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

const Version = "1"

type Job struct {
	Version        string   `json:"version"`
	Input          string   `json:"input"`
	Output         string   `json:"output"`
	Text           string   `json:"text,omitempty"`
	Font           string   `json:"font,omitempty"`
	Palette        []string `json:"palette,omitempty"`
	AlphaThreshold int      `json:"alphaThreshold,omitempty"`
	Width          int      `json:"width,omitempty"`
	Height         int      `json:"height,omitempty"`
	Margin         int      `json:"margin,omitempty"`
	Columns        int      `json:"columns,omitempty"`
	Background     string   `json:"background,omitempty"`
}
type Cell struct {
	X         int    `json:"x"`
	Y         int    `json:"y"`
	Character string `json:"character"`
	Color     string `json:"color"`
}
type Mapping struct {
	Version        string  `json:"version"`
	Width          int     `json:"width"`
	Height         int     `json:"height"`
	Columns        int     `json:"columns"`
	Rows           int     `json:"rows"`
	OriginX        float64 `json:"originX"`
	OriginY        float64 `json:"originY"`
	CellWidth      float64 `json:"cellWidth"`
	CellHeight     float64 `json:"cellHeight"`
	FontSize       float64 `json:"fontSize"`
	FontHash       string  `json:"fontHash"`
	Font           string  `json:"font"`
	SourceHash     string  `json:"sourceHash"`
	TextHash       string  `json:"textHash"`
	TextLength     int     `json:"textLength"`
	CharactersUsed int     `json:"charactersUsed"`
	WordsUsed      int     `json:"wordsUsed"`
	VisibleCells   int     `json:"visibleCells"`
	TextExhausted  bool    `json:"textExhausted"`
	Cells          []Cell  `json:"cells"`
}
type Result struct {
	Version           string `json:"version"`
	Command           string `json:"command"`
	Path              string `json:"path"`
	SHA256            string `json:"sha256"`
	PixelHash         string `json:"pixelHash,omitempty"`
	Width             int    `json:"width,omitempty"`
	Height            int    `json:"height,omitempty"`
	Bytes             int64  `json:"bytes"`
	DurationMS        int64  `json:"durationMs"`
	OpaquePixels      int    `json:"opaquePixels,omitempty"`
	TransparentPixels int    `json:"transparentPixels,omitempty"`
	PartialPixels     int    `json:"partialPixels,omitempty"`
	CharactersUsed    int    `json:"charactersUsed,omitempty"`
	WordsUsed         int    `json:"wordsUsed,omitempty"`
	TextLength        int    `json:"textLength,omitempty"`
	VisibleCells      int    `json:"visibleCells,omitempty"`
	TextExhausted     bool   `json:"textExhausted,omitempty"`
}

func Hash(data []byte) string { h := sha256.Sum256(data); return hex.EncodeToString(h[:]) }
func ParseColor(s string) (color.NRGBA, error) {
	if len(s) != 7 || s[0] != '#' {
		return color.NRGBA{}, fmt.Errorf("invalid RGB color %q", s)
	}
	b, e := hex.DecodeString(s[1:])
	if e != nil {
		return color.NRGBA{}, e
	}
	return color.NRGBA{R: b[0], G: b[1], B: b[2], A: 255}, nil
}
func colorHex(c color.NRGBA) string { return fmt.Sprintf("#%02X%02X%02X", c.R, c.G, c.B) }
func NormalizeText(s string) string { return strings.Join(strings.Fields(s), " ") }
func readPNG(path string) (*image.NRGBA, error) {
	f, e := os.Open(path)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	cfg, e := png.DecodeConfig(f)
	if e != nil {
		return nil, e
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > 40000000 {
		return nil, errors.New("PNG exceeds 40 million pixel input limit")
	}
	if _, e = f.Seek(0, 0); e != nil {
		return nil, e
	}
	img, e := png.Decode(f)
	if e != nil {
		return nil, e
	}
	out := image.NewNRGBA(image.Rect(0, 0, cfg.Width, cfg.Height))
	draw.Draw(out, out.Bounds(), img, img.Bounds().Min, draw.Src)
	return out, nil
}
func writeNew(path string, data []byte) error {
	if e := os.MkdirAll(filepath.Dir(path), 0755); e != nil {
		return e
	}
	f, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if e != nil {
		return e
	}
	_, e = f.Write(data)
	ce := f.Close()
	if e != nil {
		os.Remove(path)
		return e
	}
	return ce
}
func savePNG(path string, img image.Image) error {
	if e := os.MkdirAll(filepath.Dir(path), 0755); e != nil {
		return e
	}
	f, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if e != nil {
		return e
	}
	e = png.Encode(f, img)
	ce := f.Close()
	if e != nil {
		os.Remove(path)
		return e
	}
	return ce
}
func artifact(path, command string, start time.Time) (Result, error) {
	data, e := os.ReadFile(path)
	if e != nil {
		return Result{}, e
	}
	absolute, e := filepath.Abs(path)
	if e != nil {
		return Result{}, e
	}
	return Result{Version: Version, Command: command, Path: absolute, SHA256: Hash(data), Bytes: int64(len(data)), DurationMS: time.Since(start).Milliseconds()}, nil
}
func Run(command string, j Job) (Result, error) {
	start := time.Now()
	if j.Version != Version {
		return Result{}, errors.New("job version must be 1")
	}
	if j.Input == "" || (j.Output == "" && command != "inspect") {
		return Result{}, errors.New("input and output paths are required")
	}
	var r Result
	var e error
	switch command {
	case "prepare":
		r, e = prepare(j, start)
	case "map":
		r, e = mapImage(j, start)
	case "render":
		r, e = render(j, start)
	case "inspect":
		r, e = inspect(j, start)
	default:
		return r, fmt.Errorf("unknown command %q", command)
	}
	return r, e
}
func inspect(j Job, start time.Time) (Result, error) {
	img, e := readPNG(j.Input)
	if e != nil {
		return Result{}, e
	}
	r, e := artifact(j.Input, "inspect", start)
	if e != nil {
		return r, e
	}
	r.Width = img.Bounds().Dx()
	r.Height = img.Bounds().Dy()
	r.PixelHash = Hash(img.Pix)
	for i := 3; i < len(img.Pix); i += 4 {
		switch img.Pix[i] {
		case 0:
			r.TransparentPixels++
		case 255:
			r.OpaquePixels++
		default:
			r.PartialPixels++
		}
	}
	return r, nil
}
func prepare(j Job, start time.Time) (Result, error) {
	img, e := readPNG(j.Input)
	if e != nil {
		return Result{}, e
	}
	if len(j.Palette) < 1 || len(j.Palette) > 2 {
		return Result{}, errors.New("palette requires one or two RGB colors")
	}
	threshold := j.AlphaThreshold
	if threshold == 0 {
		threshold = 128
	}
	if threshold < 1 || threshold > 255 {
		return Result{}, errors.New("alphaThreshold must be 1..255")
	}
	palette := make([]color.NRGBA, len(j.Palette))
	for i, s := range j.Palette {
		palette[i], e = ParseColor(s)
		if e != nil {
			return Result{}, e
		}
	}
	opaque, transparent := 0, 0
	for y := 0; y < img.Bounds().Dy(); y++ {
		for x := 0; x < img.Bounds().Dx(); x++ {
			c := img.NRGBAAt(x, y)
			if int(c.A) < threshold {
				img.SetNRGBA(x, y, color.NRGBA{})
				transparent++
				continue
			}
			best, distance := 0, math.MaxInt
			for i, p := range palette {
				dr, dg, db := int(c.R)-int(p.R), int(c.G)-int(p.G), int(c.B)-int(p.B)
				d := dr*dr + dg*dg + db*db
				if d < distance {
					best, distance = i, d
				}
			}
			img.SetNRGBA(x, y, palette[best])
			opaque++
		}
	}
	if opaque == 0 || transparent < (img.Bounds().Dx()*img.Bounds().Dy()+99)/100 {
		return Result{}, errors.New("master must contain visible art and real transparency; opaque matte and empty masks are rejected")
	}
	if e = savePNG(j.Output, img); e != nil {
		return Result{}, e
	}
	r, e := artifact(j.Output, "prepare", start)
	r.Width = img.Bounds().Dx()
	r.Height = img.Bounds().Dy()
	r.OpaquePixels = opaque
	r.TransparentPixels = transparent
	r.PixelHash = Hash(img.Pix)
	return r, e
}
func fontFace(path string, size float64) (font.Face, string, error) {
	data, e := os.ReadFile(path)
	if e != nil {
		return nil, "", e
	}
	parsed, e := opentype.Parse(data)
	if e != nil {
		return nil, "", e
	}
	face, e := opentype.NewFace(parsed, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingNone})
	return face, Hash(data), e
}
func mapImage(j Job, start time.Time) (Result, error) {
	if j.Text == "" || j.Font == "" {
		return Result{}, errors.New("text and font are required")
	}
	img, e := readPNG(j.Input)
	if e != nil {
		return Result{}, e
	}
	raw, e := os.ReadFile(j.Text)
	if e != nil {
		return Result{}, e
	}
	if !utf8.Valid(raw) {
		return Result{}, errors.New("text must be UTF-8")
	}
	text := NormalizeText(string(raw))
	chars := []rune(text)
	if len(chars) == 0 {
		return Result{}, errors.New("story body is empty")
	}
	if j.Width == 0 {
		j.Width = 3600
	}
	if j.Height == 0 {
		j.Height = 5400
	}
	if j.Columns == 0 {
		j.Columns = 420
	}
	if j.Width < 16 || j.Height < 16 || int64(j.Width)*int64(j.Height) > 50000000 || j.Margin < 0 || j.Margin*2 >= j.Width || j.Margin*2 >= j.Height || j.Columns < 2 || j.Columns > 4000 {
		return Result{}, errors.New("invalid layout dimensions, margin, or columns")
	}
	availableW, availableH := float64(j.Width-2*j.Margin), float64(j.Height-2*j.Margin)
	ratio := float64(img.Bounds().Dx()) / float64(img.Bounds().Dy())
	artW := math.Min(availableW, availableH*ratio)
	artH := artW / ratio
	face, _, e := fontFace(j.Font, 100)
	if e != nil {
		return Result{}, e
	}
	advance, _ := face.GlyphAdvance('M')
	cw := artW / float64(j.Columns)
	size := cw / (float64(advance) / 64) * 100
	face.Close()
	face, fontHash, e := fontFace(j.Font, size)
	if e != nil {
		return Result{}, e
	}
	defer face.Close()
	lineHeight := float64(face.Metrics().Height) / 64
	rows := int(math.Round(artH / lineHeight))
	if rows < 1 || j.Columns*rows > 4000000 {
		return Result{}, errors.New("invalid grid density")
	}
	fontPath, e := filepath.Abs(j.Font)
	if e != nil {
		return Result{}, e
	}
	sourceBytes, e := os.ReadFile(j.Input)
	if e != nil {
		return Result{}, e
	}
	m := Mapping{Version: Version, Width: j.Width, Height: j.Height, Columns: j.Columns, Rows: rows, OriginX: (float64(j.Width) - artW) / 2, OriginY: (float64(j.Height) - float64(rows)*lineHeight) / 2, CellWidth: cw, CellHeight: lineHeight, FontSize: size, Font: fontPath, FontHash: fontHash, SourceHash: Hash(sourceBytes), TextHash: Hash([]byte(text)), TextLength: len(chars), Cells: []Cell{}}
	for y := 0; y < rows; y++ {
		for x := 0; x < j.Columns; x++ {
			sx := int((float64(x) + 0.5) * float64(img.Bounds().Dx()) / float64(j.Columns))
			sy := int((float64(y) + 0.5) * float64(img.Bounds().Dy()) / float64(rows))
			c := img.NRGBAAt(sx, sy)
			if c.A == 0 {
				continue
			}
			m.VisibleCells++
			if m.CharactersUsed >= len(chars) {
				continue
			}
			if _, supported := face.GlyphAdvance(chars[m.CharactersUsed]); !supported {
				return Result{}, fmt.Errorf("font cannot render story character U+%04X at offset %d", chars[m.CharactersUsed], m.CharactersUsed)
			}
			m.Cells = append(m.Cells, Cell{X: x, Y: y, Character: string(chars[m.CharactersUsed]), Color: colorHex(c)})
			m.CharactersUsed++
		}
	}
	if m.VisibleCells == 0 {
		return Result{}, errors.New("sampled grid contains no visible cells")
	}
	m.TextExhausted = m.CharactersUsed == len(chars) && m.VisibleCells > len(chars)
	m.WordsUsed = len(strings.Fields(string(chars[:m.CharactersUsed])))
	data, e := json.Marshal(m)
	if e != nil {
		return Result{}, e
	}
	if e = writeNew(j.Output, append(data, '\n')); e != nil {
		return Result{}, e
	}
	r, e := artifact(j.Output, "map", start)
	r.Width = j.Width
	r.Height = j.Height
	r.CharactersUsed = m.CharactersUsed
	r.WordsUsed = m.WordsUsed
	r.TextLength = m.TextLength
	r.VisibleCells = m.VisibleCells
	r.TextExhausted = m.TextExhausted
	return r, e
}
func render(j Job, start time.Time) (Result, error) {
	data, e := os.ReadFile(j.Input)
	if e != nil {
		return Result{}, e
	}
	var m Mapping
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if e = decoder.Decode(&m); e != nil {
		return Result{}, e
	}
	if m.Version != Version || m.Width < 1 || m.Height < 1 || int64(m.Width)*int64(m.Height) > 50000000 || m.Columns < 1 || m.Rows < 1 || m.CellWidth <= 0 || m.CellHeight <= 0 || m.FontSize <= 0 || math.IsNaN(m.FontSize) {
		return Result{}, errors.New("invalid mapping geometry")
	}
	path := j.Font
	if path == "" {
		path = m.Font
	}
	face, hash, e := fontFace(path, m.FontSize)
	if e != nil {
		return Result{}, e
	}
	defer face.Close()
	if hash != m.FontHash {
		return Result{}, errors.New("font bytes differ from mapped font")
	}
	background := j.Background
	if background == "" {
		background = "#F4EFE4"
	}
	bg, e := ParseColor(background)
	if e != nil {
		return Result{}, e
	}
	img := image.NewNRGBA(image.Rect(0, 0, m.Width, m.Height))
	draw.Draw(img, img.Bounds(), image.NewUniform(bg), image.Point{}, draw.Src)
	drawer := font.Drawer{Dst: img, Face: face}
	ascent := float64(face.Metrics().Ascent) / 64
	for _, c := range m.Cells {
		if c.X < 0 || c.X >= m.Columns || c.Y < 0 || c.Y >= m.Rows || utf8.RuneCountInString(c.Character) != 1 {
			return Result{}, errors.New("invalid mapped cell")
		}
		rgb, e := ParseColor(c.Color)
		if e != nil {
			return Result{}, e
		}
		drawer.Src = image.NewUniform(rgb)
		drawer.Dot = fixed.Point26_6{X: fixed.Int26_6(math.Round((m.OriginX + float64(c.X)*m.CellWidth) * 64)), Y: fixed.Int26_6(math.Round((m.OriginY + float64(c.Y)*m.CellHeight + ascent) * 64))}
		drawer.DrawString(c.Character)
	}
	if e = savePNG(j.Output, img); e != nil {
		return Result{}, e
	}
	r, e := artifact(j.Output, "render", start)
	r.PixelHash = Hash(img.Pix)
	r.Width = m.Width
	r.Height = m.Height
	r.CharactersUsed = m.CharactersUsed
	r.WordsUsed = m.WordsUsed
	r.TextLength = m.TextLength
	r.VisibleCells = m.VisibleCells
	r.TextExhausted = m.TextExhausted
	return r, e
}
