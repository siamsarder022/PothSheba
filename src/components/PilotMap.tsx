import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Layers, LocateFixed, MapPin } from 'lucide-react';
import type {
  IssueType,
  PilotLandmark,
  PilotRoadCorridor,
  RoadIssue,
  SensorDevice,
  SeverityLevel,
} from '../types/pothsheba.ts';

interface PilotMapProps {
  center: [number, number];
  roads: PilotRoadCorridor[];
  landmarks: PilotLandmark[];
  issues: RoadIssue[];
  devices: SensorDevice[];
  selectedIssueId?: string | null;
  onSelectIssue?: (issueId: string) => void;
  pickMode?: boolean;
  pickedLocation?: [number, number] | null;
  onPickLocation?: (lat: number, lng: number) => void;
  heightClass?: string;
}

const SEVERITY_HEX: Record<SeverityLevel, string> = {
  Critical: '#DC2626',
  High: '#EA580C',
  Medium: '#D97706',
  Low: '#0D9488',
};

function issueShapeSvg(type: IssueType, fill: string, dashed: boolean, selected: boolean): string {
  const stroke = selected ? '#0F172A' : '#FFFFFF';
  const strokeW = selected ? 3 : 2;
  const dashAttr = dashed ? 'stroke-dasharray="3 2"' : '';
  const opacity = dashed ? '0.78' : '0.96';

  switch (type) {
    case 'Pothole':
      return `<svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="9.5" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${strokeW}" ${dashAttr}/></svg>`;
    case 'Crack':
      return `<svg width="26" height="26" viewBox="0 0 26 26"><polygon points="13,2 24,13 13,24 2,13" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${strokeW}" ${dashAttr}/></svg>`;
    case 'Speed breaker':
      return `<svg width="26" height="26" viewBox="0 0 26 26"><polygon points="13,3 24,22 2,22" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${strokeW}" ${dashAttr}/></svg>`;
    case 'Waterlogging':
      return `<svg width="26" height="26" viewBox="0 0 26 26"><path d="M13 2 C19 9 22 13 22 17 A9 9 0 1 1 4 17 C4 13 7 9 13 2 Z" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${strokeW}" ${dashAttr}/></svg>`;
    case 'Bin full':
      return `<svg width="26" height="26" viewBox="0 0 26 26"><rect x="4" y="4" width="18" height="18" rx="3" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${strokeW}" ${dashAttr}/></svg>`;
    case 'Street light off':
      return `<svg width="26" height="26" viewBox="0 0 26 26"><polygon points="13,2 16,9 24,9 18,14 20,22 13,17 6,22 8,14 2,9 10,9" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${strokeW}" ${dashAttr}/></svg>`;
  }
}

export function PilotMap({
  center,
  roads,
  landmarks,
  issues,
  devices,
  selectedIssueId,
  onSelectIssue,
  pickMode = false,
  pickedLocation = null,
  onPickLocation,
  heightClass = 'h-[480px]',
}: PilotMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const overlayGroupRef = useRef<L.LayerGroup | null>(null);
  const [useOsmTiles, setUseOsmTiles] = useState(true);
  const [tileWarning, setTileWarning] = useState(false);

  // Initialize Leaflet map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center,
      zoom: 16,
      zoomControl: true,
      attributionControl: true,
    });

    const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    });

    tileLayer.on('tileerror', () => {
      setTileWarning(true);
    });
    tileLayer.on('tileload', () => {
      setTileWarning(false);
    });

    tileLayer.addTo(map);
    const overlayGroup = L.layerGroup().addTo(map);

    mapRef.current = map;
    tileLayerRef.current = tileLayer;
    overlayGroupRef.current = overlayGroup;

    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      overlayGroupRef.current = null;
    };
  }, [center]);

  // Toggle OSM tile layer vs clean schematic grid canvas
  useEffect(() => {
    const map = mapRef.current;
    const tileLayer = tileLayerRef.current;
    if (!map || !tileLayer) return;
    if (useOsmTiles) {
      if (!map.hasLayer(tileLayer)) {
        tileLayer.addTo(map);
      }
    } else {
      if (map.hasLayer(tileLayer)) {
        map.removeLayer(tileLayer);
      }
    }
  }, [useOsmTiles]);

  // Click handler for citizen picker mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleClick = (e: L.LeafletMouseEvent) => {
      if (pickMode && onPickLocation) {
        onPickLocation(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
      }
    };

    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [pickMode, onPickLocation]);

  // Sync roads, landmarks, devices, issues, and pick marker
  useEffect(() => {
    const group = overlayGroupRef.current;
    const map = mapRef.current;
    if (!group || !map) return;

    group.clearLayers();

    // Pilot road corridors
    roads.forEach((road) => {
      L.polyline(road.coordinates, {
        color: useOsmTiles ? '#0F766E' : '#334155',
        weight: useOsmTiles ? 5 : 10,
        opacity: useOsmTiles ? 0.55 : 0.8,
      })
        .bindTooltip(`${road.name} · Traffic ${road.trafficScore}/100`, {
          sticky: true,
        })
        .addTo(group);
    });

    // Risk landmarks (School, Hospital, Bus stop)
    landmarks.forEach((lm) => {
      const tag = lm.kind === 'School' ? 'S' : lm.kind === 'Hospital' ? 'H' : 'B';
      const icon = L.divIcon({
        className: 'ps-landmark-icon',
        html: `<div style="width:24px;height:24px;border-radius:6px;background:#0F172A;color:#FFFFFF;border:2px solid #FFFFFF;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;box-shadow:0 2px 6px rgba(0,0,0,0.25);">${tag}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      L.marker([lm.lat, lm.lng], { icon })
        .bindPopup(`<strong>${lm.name}</strong><br/>Risk context: ${lm.kind}`)
        .addTo(group);
    });

    // 3 Sensor Devices
    devices.forEach((dev) => {
      const bg =
        dev.status === 'Offline'
          ? '#64748B'
          : dev.category === 'pole'
          ? '#1D4ED8'
          : '#0F766E';
      const label = dev.category === 'pole' ? 'P3' : dev.id === 'VEH-01' ? 'V1' : 'V2';
      const icon = L.divIcon({
        className: 'ps-device-icon',
        html: `<div style="padding:2px 6px;border-radius:4px;background:${bg};color:#FFF;border:1.5px solid #FFF;font-size:10px;font-weight:700;font-family:monospace;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3);">${label} · ${dev.name}</div>`,
        iconSize: [74, 22],
        iconAnchor: [37, 11],
      });
      L.marker([dev.lat, dev.lng], { icon })
        .bindPopup(
          `<strong>${dev.name} (${dev.id})</strong><br/>Status: ${dev.status}<br/>${dev.mountLabel}<br/>Queued offline: ${dev.offlineQueue.length}`
        )
        .addTo(group);
    });

    // Issues
    issues.forEach((issue) => {
      const isUnconfirmed = issue.status === 'Unconfirmed';
      const isResolved = issue.status === 'Resolved';
      const isSelected = issue.id === selectedIssueId;
      const color = isResolved ? '#15803D' : SEVERITY_HEX[issue.severity];

      const icon = L.divIcon({
        className: 'ps-issue-icon',
        html: issueShapeSvg(issue.type, color, isUnconfirmed, isSelected),
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });

      const marker = L.marker([issue.lat, issue.lng], {
        icon,
        zIndexOffset: isSelected ? 500 : issue.severity === 'Critical' ? 200 : 50,
      });

      marker.bindPopup(
        `<div style="min-width:190px">
          <div style="font-weight:700;font-size:13px;color:#0F172A">${issue.id} · ${issue.type}</div>
          <div style="font-size:12px;color:#475569;margin-top:2px">${issue.severity} (${issue.priorityScore}/100) · ${issue.status}</div>
          <div style="font-size:12px;color:#475569">${issue.roadName} · ${issue.confirmationCount} report(s)</div>
        </div>`
      );

      marker.on('click', () => {
        if (onSelectIssue) onSelectIssue(issue.id);
      });

      marker.addTo(group);
    });

    // Citizen picked marker
    if (pickMode && pickedLocation) {
      const pickIcon = L.divIcon({
        className: 'ps-pick-icon',
        html: `<div style="width:20px;height:20px;border-radius:999px;background:#F59E0B;border:3px solid #0F172A;box-shadow:0 2px 8px rgba(0,0,0,0.35);"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      L.marker(pickedLocation, { icon: pickIcon, zIndexOffset: 700 })
        .bindTooltip('Selected report location', { permanent: false })
        .addTo(group);
    }
  }, [roads, landmarks, devices, issues, selectedIssueId, onSelectIssue, pickMode, pickedLocation, useOsmTiles]);

  const handleRecenter = () => {
    mapRef.current?.setView(center, 16);
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
          <span className="font-medium text-slate-800">
            Dhaka Pilot Corridor (OpenStreetMap / Leaflet)
          </span>
          {pickMode && (
            <span className="text-amber-700 font-medium">
              · Click map to place report pin
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setUseOsmTiles((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
          >
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{useOsmTiles ? 'OSM Map Tiles' : 'Corridor Grid'}</span>
          </button>
          <button
            type="button"
            onClick={handleRecenter}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
          >
            <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Center Pilot</span>
          </button>
        </div>
      </div>

      {tileWarning && useOsmTiles && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          OpenStreetMap tiles could not load in this network environment. Corridor vector geometry remains active; switch to Corridor Grid for higher contrast.
        </div>
      )}

      <div
        ref={containerRef}
        className={`w-full ${heightClass} ${pickMode ? 'cursor-crosshair' : ''}`}
        aria-label="Interactive Dhaka pilot area map"
      />

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-slate-700">Severity:</span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-red-600" /> Critical
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-orange-600" /> High
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-600" /> Medium
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-teal-600" /> Low
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-700" /> Resolved
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-slate-700">Shapes:</span>
          <span>Circle = Pothole</span>
          <span>Diamond = Crack</span>
          <span>Triangle = Speed breaker</span>
          <span>Drop = Waterlogging</span>
          <span>Square = Bin full</span>
          <span>Star = Street light</span>
          <span className="text-slate-500">· Dashed border = Unconfirmed</span>
        </div>
      </div>
    </div>
  );
}
